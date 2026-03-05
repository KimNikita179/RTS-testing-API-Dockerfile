from __future__ import annotations

import json
from pathlib import Path
from typing import Any


RUNS_DIR = Path("runs")


def run_dir(run_id: str) -> Path:
    return RUNS_DIR / run_id


def artifacts_dir(run_id: str) -> Path:
    return run_dir(run_id) / "artifacts"


def ensure_dirs(run_id: str) -> None:
    artifacts_dir(run_id).mkdir(parents=True, exist_ok=True)


def write_json(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    tmp.replace(path)


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def state_path(run_id: str) -> Path:
    return run_dir(run_id) / "run.json"


def request_path(run_id: str) -> Path:
    return run_dir(run_id) / "request.json"

