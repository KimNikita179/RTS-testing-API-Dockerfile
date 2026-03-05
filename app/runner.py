from __future__ import annotations

import traceback
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import httpx
from jsonpath_ng import parse as jsonpath_parse
from playwright.async_api import async_playwright, expect

from .models import RunResult, RunStatus, Step, SuiteSpec, TestResult
from .storage import artifacts_dir, state_path, write_json
from .utils import deep_resolve, ensure_relative_url


def _now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def _artifact_url(run_id: str, filename: str) -> str:
    # StaticFiles смонтирован на директорию runs/, поэтому путь включает подпапку artifacts/
    return f"/artifacts/{run_id}/artifacts/{filename}"


def _safe_filename(s: str) -> str:
    return "".join(c if c.isalnum() or c in ("-", "_", ".") else "_" for c in s).strip("_")[:180] or "file"


class _StepFailed(Exception):
    pass


async def run_suite(run_id: str, suite: SuiteSpec) -> None:
    run = RunResult(
        runId=run_id,
        status=RunStatus.running,
        createdAt=_now_iso(),
        startedAt=_now_iso(),
        current=None,
        suite={"project": suite.project, "specVersion": suite.specVersion},
        results=[],
    )
    write_json(state_path(run_id), run.model_dump(by_alias=True))

    variables: dict[str, Any] = dict(suite.variables or {})
    last_api_response: dict[str, Any] | None = None

    try:
        for test_index, test in enumerate(suite.tests):
            test_ok = True
            step_results = []

            if test.type == "api":
                async with httpx.AsyncClient(base_url=suite.defaults.baseUrl, timeout=suite.defaults.timeoutsMs.navigation / 1000) as client:
                    for step_index, step in enumerate(test.steps):
                        run.current = {"testId": test.id, "stepId": step.id, "stepIndex": step_index, "testIndex": test_index}
                        write_json(state_path(run_id), run.model_dump(by_alias=True))

                        r = await _run_step_api(
                            run_id=run_id,
                            client=client,
                            step=step,
                            suite=suite,
                            variables=variables,
                            last_api_response=last_api_response,
                        )
                        last_api_response = r.get("last_api_response", last_api_response)
                        step_results.append(r["stepResult"])
                        if not r["stepResult"]["ok"]:
                            test_ok = False
                            if not step.continueOnFail:
                                break
            else:
                async with async_playwright() as pw:
                    browser_type = getattr(pw, suite.defaults.ui.browser)
                    browser = await browser_type.launch()
                    context = await browser.new_context(viewport=suite.defaults.ui.viewport)
                    page = await context.new_page()

                    if test.startUrl:
                        # Навигация по умолчанию перед шагами (если пользователь не делает это явно).
                        await page.goto(suite.defaults.baseUrl + ensure_relative_url(test.startUrl), timeout=suite.defaults.timeoutsMs.navigation)

                    for step_index, step in enumerate(test.steps):
                        run.current = {"testId": test.id, "stepId": step.id, "stepIndex": step_index, "testIndex": test_index}
                        write_json(state_path(run_id), run.model_dump(by_alias=True))

                        r = await _run_step_ui(
                            run_id=run_id,
                            page=page,
                            step=step,
                            suite=suite,
                            variables=variables,
                        )
                        step_results.append(r["stepResult"])
                        if not r["stepResult"]["ok"]:
                            test_ok = False
                            if not step.continueOnFail:
                                break

                    await context.close()
                    await browser.close()

            run.results.append(TestResult(id=test.id, name=test.name, type=test.type, ok=test_ok, steps=step_results))  # type: ignore[arg-type]
            write_json(state_path(run_id), run.model_dump(by_alias=True))

        run.status = RunStatus.completed
        run.finishedAt = _now_iso()
        run.current = None
        write_json(state_path(run_id), run.model_dump(by_alias=True))
    except Exception as e:
        run.status = RunStatus.failed
        run.finishedAt = _now_iso()
        run.current = run.current or None
        run.error = f"{type(e).__name__}: {e}\n{traceback.format_exc()}"
        write_json(state_path(run_id), run.model_dump(by_alias=True))


async def _run_step_ui(*, run_id: str, page, step: Step, suite: SuiteSpec, variables: dict[str, Any]) -> dict[str, Any]:
    started = _now_iso()
    step_timeout = step.timeoutMs or suite.defaults.timeoutsMs.step
    nav_timeout = suite.defaults.timeoutsMs.navigation

    screenshot_url: str | None = None
    saved_as: str | None = None
    ok = True
    err: str | None = None

    try:
        resolved_target = step.target.model_dump() if step.target else None
        resolved_value = deep_resolve(step.value, variables)
        resolved_expect = deep_resolve(step.expect.model_dump(by_alias=True) if step.expect else None, variables)

        if step.action == "navigate":
            url = str(resolved_value)
            url = ensure_relative_url(url)
            if url.startswith("http://") or url.startswith("https://"):
                await page.goto(url, timeout=nav_timeout)
            else:
                await page.goto(suite.defaults.baseUrl + url, timeout=nav_timeout)

        elif step.action in {"click", "fill", "press", "select", "waitFor", "scrollIntoView", "hover", "screenshot"}:
            # Для большинства действий нужен target, но для screenshot он опционален.
            if step.action == "click":
                loc = _locator(page, resolved_target)
                await loc.click(timeout=step_timeout)
            elif step.action == "fill":
                loc = _locator(page, resolved_target)
                await loc.fill("" if resolved_value is None else str(resolved_value), timeout=step_timeout)
            elif step.action == "press":
                loc = _locator(page, resolved_target)
                await loc.press("" if resolved_value is None else str(resolved_value), timeout=step_timeout)
            elif step.action == "select":
                loc = _locator(page, resolved_target)
                await loc.select_option("" if resolved_value is None else str(resolved_value), timeout=step_timeout)
            elif step.action == "hover":
                loc = _locator(page, resolved_target)
                await loc.hover(timeout=step_timeout)
            elif step.action == "scrollIntoView":
                loc = _locator(page, resolved_target)
                await loc.scroll_into_view_if_needed(timeout=step_timeout)
            elif step.action == "waitFor":
                if resolved_value is None and resolved_target:
                    loc = _locator(page, resolved_target)
                    await loc.wait_for(timeout=step_timeout)
                elif isinstance(resolved_value, (int, float)):
                    await page.wait_for_timeout(int(resolved_value))
                elif isinstance(resolved_value, dict):
                    state = resolved_value.get("state")
                    loc = _locator(page, resolved_target)
                    await loc.wait_for(timeout=step_timeout, state=state)
                else:
                    await page.wait_for_timeout(step_timeout)
            elif step.action == "screenshot":
                filename = _safe_filename(f"{step.id}-{step.action}.png")
                path = artifacts_dir(run_id) / filename
                if resolved_target:
                    loc = _locator(page, resolved_target)
                    await loc.screenshot(path=str(path))
                else:
                    await page.screenshot(path=str(path), full_page=True)
                screenshot_url = _artifact_url(run_id, filename)

        elif step.action == "assert":
            if not resolved_expect:
                raise _StepFailed("expect is required for assert action")
            await _assert_ui(page=page, expect_obj=resolved_expect, timeout_ms=step_timeout)

        elif step.action == "setVar":
            if not step.saveAs:
                raise _StepFailed("setVar requires saveAs")
            variables[step.saveAs] = resolved_value
            saved_as = step.saveAs

        else:
            raise _StepFailed(f"Unsupported UI action: {step.action}")

    except Exception as e:
        ok = False
        err = f"{type(e).__name__}: {e}"
        # Авто-скриншот на падении UI-шага, если ещё не сделан.
        try:
            if screenshot_url is None:
                filename = _safe_filename(f"{step.id}-failure.png")
                path = artifacts_dir(run_id) / filename
                await page.screenshot(path=str(path), full_page=True)
                screenshot_url = _artifact_url(run_id, filename)
        except Exception:
            pass

    finished = _now_iso()
    return {
        "stepResult": {
            "id": step.id,
            "action": step.action,
            "ok": ok,
            "startedAt": started,
            "finishedAt": finished,
            "error": err,
            "screenshotUrl": screenshot_url,
            "savedAs": saved_as,
        }
    }


def _locator(page, target: dict[str, Any] | None):
    if not target:
        raise _StepFailed("target is required for this action")
    using = target.get("using")
    value = target.get("value")
    if using == "css":
        return page.locator(value)
    if using == "xpath":
        return page.locator(f"xpath={value}")
    if using == "text":
        return page.get_by_text(value)
    if using == "testId":
        return page.get_by_test_id(value)
    raise _StepFailed(f"Unsupported locator using: {using}")


async def _assert_ui(*, page, expect_obj: dict[str, Any], timeout_ms: int) -> None:
    kind = expect_obj.get("kind")
    if kind == "urlContains":
        needle = str(expect_obj.get("value") or "")
        if needle not in page.url:
            raise _StepFailed(f"urlContains failed: '{needle}' not in '{page.url}'")
        return

    if kind == "locator":
        loc = _locator(page, expect_obj.get("target"))
        assert_kind = expect_obj.get("assert")
        value = expect_obj.get("value")

        if assert_kind == "visible":
            await expect(loc).to_be_visible(timeout=timeout_ms)
        elif assert_kind == "hidden":
            await expect(loc).to_be_hidden(timeout=timeout_ms)
        elif assert_kind == "enabled":
            await expect(loc).to_be_enabled(timeout=timeout_ms)
        elif assert_kind == "disabled":
            await expect(loc).to_be_disabled(timeout=timeout_ms)
        elif assert_kind == "exists":
            if await loc.count() < 1:
                raise _StepFailed("exists failed: locator not found")
        elif assert_kind == "notExists":
            if await loc.count() > 0:
                raise _StepFailed("notExists failed: locator exists")
        elif assert_kind == "textEquals":
            await expect(loc).to_have_text("" if value is None else str(value), timeout=timeout_ms)
        elif assert_kind == "textContains":
            await expect(loc).to_contain_text("" if value is None else str(value), timeout=timeout_ms)
        elif assert_kind == "attrEquals":
            if not isinstance(value, dict) or "name" not in value:
                raise _StepFailed("attrEquals requires value: {name, value}")
            name = str(value.get("name"))
            expected = None if value.get("value") is None else str(value.get("value"))
            attr = await loc.get_attribute(name)
            if attr != expected:
                raise _StepFailed(f"attrEquals failed: {name}='{attr}' != '{expected}'")
        else:
            raise _StepFailed(f"Unsupported locator assert: {assert_kind}")
        return

    raise _StepFailed(f"Unsupported expect.kind: {kind}")


async def _run_step_api(
    *,
    run_id: str,
    client: httpx.AsyncClient,
    step: Step,
    suite: SuiteSpec,
    variables: dict[str, Any],
    last_api_response: dict[str, Any] | None,
) -> dict[str, Any]:
    started = _now_iso()
    step_timeout = step.timeoutMs or suite.defaults.timeoutsMs.step

    ok = True
    err: str | None = None
    saved_as: str | None = None

    try:
        resolved_value = deep_resolve(step.value, variables)
        resolved_expect = deep_resolve(step.expect.model_dump(by_alias=True) if step.expect else None, variables)

        if step.action == "request":
            if not isinstance(resolved_value, dict):
                raise _StepFailed("request.value must be an object")
            method = str(resolved_value.get("method", "GET")).upper()
            url = ensure_relative_url(str(resolved_value.get("url", "/")))
            headers = resolved_value.get("headers") or {}
            params = resolved_value.get("params")
            json_body = resolved_value.get("json")
            data = resolved_value.get("data")

            resp = await client.request(method, url, headers=headers, params=params, json=json_body, data=data, timeout=step_timeout / 1000)
            parsed_json: Any | None = None
            try:
                parsed_json = resp.json()
            except Exception:
                parsed_json = None

            last_api_response = {
                "status": resp.status_code,
                "headers": dict(resp.headers),
                "text": resp.text,
                "json": parsed_json,
                "url": str(resp.url),
            }

            if step.saveAs:
                variables[step.saveAs] = last_api_response
                saved_as = step.saveAs

        elif step.action == "assert":
            if not resolved_expect:
                raise _StepFailed("expect is required for assert action")
            _assert_api(expect_obj=resolved_expect, variables=variables, last_api_response=last_api_response)

        elif step.action == "setVar":
            if not step.saveAs:
                raise _StepFailed("setVar requires saveAs")
            variables[step.saveAs] = resolved_value
            saved_as = step.saveAs

        elif step.action == "extract":
            # Минимальная поддержка: value = { "from": "${var}" | null, "path": "$.a.b" }
            if not step.saveAs:
                raise _StepFailed("extract requires saveAs")
            if not isinstance(resolved_value, dict):
                raise _StepFailed("extract.value must be an object")
            from_ref = resolved_value.get("from")
            path = resolved_value.get("path")
            if not path:
                raise _StepFailed("extract.value.path is required")
            src = _api_from(from_ref, variables, last_api_response)
            data = src.get("json") if isinstance(src, dict) else src
            extracted = _jsonpath_get_one(data, str(path))
            variables[step.saveAs] = extracted
            saved_as = step.saveAs

        else:
            raise _StepFailed(f"Unsupported API action: {step.action}")

    except Exception as e:
        ok = False
        err = f"{type(e).__name__}: {e}"

    finished = _now_iso()
    return {
        "last_api_response": last_api_response,
        "stepResult": {
            "id": step.id,
            "action": step.action,
            "ok": ok,
            "startedAt": started,
            "finishedAt": finished,
            "error": err,
            "screenshotUrl": None,
            "savedAs": saved_as,
        },
    }


def _api_from(from_ref: Any, variables: dict[str, Any], last_api_response: dict[str, Any] | None) -> Any:
    if from_ref is None:
        if last_api_response is None:
            raise _StepFailed("No previous API response available")
        return last_api_response
    if isinstance(from_ref, str) and from_ref.startswith("${") and from_ref.endswith("}"):
        key = from_ref[2:-1]
        if key not in variables:
            raise _StepFailed(f"Unknown variable in from: {from_ref}")
        return variables[key]
    if isinstance(from_ref, str) and from_ref in variables:
        return variables[from_ref]
    return from_ref


def _assert_api(*, expect_obj: dict[str, Any], variables: dict[str, Any], last_api_response: dict[str, Any] | None) -> None:
    kind = expect_obj.get("kind")
    from_ref = expect_obj.get("from")
    src = _api_from(from_ref, variables, last_api_response)
    if not isinstance(src, dict):
        raise _StepFailed("API assert source must be an object (response)")

    if kind == "status":
        expected = expect_obj.get("equals")
        if src.get("status") != expected:
            raise _StepFailed(f"status assert failed: {src.get('status')} != {expected}")
        return

    if kind == "jsonPathEquals":
        path = expect_obj.get("path")
        expected = expect_obj.get("equals")
        data = src.get("json")
        actual = _jsonpath_get_one(data, str(path))
        if actual != expected:
            raise _StepFailed(f"jsonPathEquals failed: {actual} != {expected} (path={path})")
        return

    raise _StepFailed(f"Unsupported API expect.kind: {kind}")


def _jsonpath_get_one(data: Any, path: str) -> Any:
    if data is None:
        return None
    expr = jsonpath_parse(path)
    matches = [m.value for m in expr.find(data)]
    if not matches:
        return None
    if len(matches) == 1:
        return matches[0]
    return matches

