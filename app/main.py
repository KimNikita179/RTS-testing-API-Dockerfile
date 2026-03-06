from __future__ import annotations

import asyncio
import json
from datetime import datetime, timezone
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.staticfiles import StaticFiles
from pydantic import ValidationError
from uuid import uuid4

from .models import Defaults, RunResult, RunStatus, SuiteSpec, TestSpec
from .runner import run_suite
from .storage import RUNS_DIR, ensure_dirs, request_path, state_path, write_json, read_json


app = FastAPI(title="RTC Playwright Runner", version="0.1.0")

RUN_TASKS: dict[str, asyncio.Task[None]] = {}


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@app.get("/")
async def root() -> dict[str, Any]:
    return {
        "service": "rtc-testing-api",
        "endpoints": {
            "createRun": {"method": "POST", "path": "/runs"},
            "getRun": {"method": "GET", "path": "/runs/{runId}"},
            "artifacts": {"method": "GET", "path": "/artifacts/{runId}/{filePath}"},
        },
        "note": "Смотрите примеры входных JSON в папке jsonInput/.",
    }


@app.post("/runs")
async def create_run(
    request: Request,
    baseUrl: str | None = None,
) -> dict[str, Any]:
    # Читаем сырое тело запроса как текст и сами парсим JSON.
    try:
        raw = await request.body()
        text = raw.decode("utf-8")
        payload = json.loads(text)
        if not isinstance(payload, dict):
            raise ValueError("Корневой JSON должен быть объектом")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid JSON body: {e}")

    run_id = str(uuid4())
    ensure_dirs(run_id)

    suite = _parse_suite(payload, base_url_override=baseUrl)

    write_json(request_path(run_id), payload)
    run_state = RunResult(
        runId=run_id,
        status=RunStatus.queued,
        createdAt=_now_iso(),
        current=None,
        suite={"project": suite.project, "specVersion": suite.specVersion},
        results=None,
    )
    write_json(state_path(run_id), run_state.model_dump(by_alias=True))

    task = asyncio.create_task(run_suite(run_id, suite))
    RUN_TASKS[run_id] = task

    return {
        "runId": run_id,
        "resultUrl": str(request.base_url).rstrip("/") + f"/runs/{run_id}",
        "resultPath": f"/runs/{run_id}",
        "artifactsBaseUrl": str(request.base_url).rstrip("/") + f"/artifacts/{run_id}/artifacts/",
        "artifactsBasePath": f"/artifacts/{run_id}/artifacts/",
    }


@app.get("/runs/{run_id}")
async def get_run(run_id: str) -> dict[str, Any]:
    p = state_path(run_id)
    if not p.exists():
        raise HTTPException(status_code=404, detail="run not found")
    return read_json(p)

@app.get("/runs")
async def list_runs() -> list[dict[str, Any]]:
    # read all run.json files in the runs directory and return as an array
    results: list[dict[str, Any]] = []
    for d in RUNS_DIR.iterdir():
        if d.is_dir():
            st = d / "run.json"
            if st.exists():
                try:
                    results.append(read_json(st))
                except Exception:
                    pass
    # optionally sort by createdAt desc
    results.sort(key=lambda x: x.get("createdAt", ""), reverse=True)
    return results


from pathlib import Path


# Раздача артефактов (скриншоты, html, etc)
RUNS_DIR.mkdir(parents=True, exist_ok=True)
app.mount("/artifacts", StaticFiles(directory=str(RUNS_DIR), html=False), name="artifacts")

# Статика фронтенда
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
if FRONTEND_DIR.exists():
    app.mount("/app", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")


def _parse_suite(payload: dict[str, Any], *, base_url_override: str | None) -> SuiteSpec:
    # 1) Полный suite-объект (structure/fullExample)
    if "defaults" in payload:
        try:
            return SuiteSpec.model_validate(payload)
        except ValidationError as e:
            raise HTTPException(status_code=422, detail=e.errors())

    # 2) Один тест (uiExample/apiExample) + baseUrl через query (?baseUrl=...)
    if "steps" in payload and "type" in payload:
        if not base_url_override:
            raise HTTPException(
                status_code=400,
                detail="Для одиночного теста нужно передать baseUrl: либо в JSON (defaults.baseUrl), либо query-параметром ?baseUrl=https://...",
            )
        try:
            test = TestSpec.model_validate(payload)
        except ValidationError as e:
            raise HTTPException(status_code=422, detail=e.errors())
        suite_payload = {
            "specVersion": "1.0",
            "project": None,
            "defaults": Defaults(baseUrl=base_url_override).model_dump(),
            "variables": {},
            "tests": [test.model_dump()],
        }
        return SuiteSpec.model_validate(suite_payload)

    raise HTTPException(status_code=400, detail="Непонятный формат JSON. Ожидается suite (с defaults+tests) или один test (с steps+type).")

