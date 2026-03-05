from __future__ import annotations

from enum import Enum
from typing import Any, Literal

from pydantic import BaseModel, Field


class LocatorUsing(str, Enum):
    css = "css"
    xpath = "xpath"
    text = "text"
    testId = "testId"


class Locator(BaseModel):
    using: LocatorUsing
    value: str


class StepExpect(BaseModel):
    kind: str
    # UI expect
    target: Locator | None = None
    assert_: str | None = Field(default=None, alias="assert")
    value: Any | None = None
    # API expect
    from_: str | None = Field(default=None, alias="from")
    equals: Any | None = None
    path: str | None = None


class Step(BaseModel):
    id: str
    action: str
    target: Locator | None = None
    value: Any | None = None
    expect: StepExpect | None = None
    saveAs: str | None = None
    timeoutMs: int | None = None
    continueOnFail: bool = False


class DefaultsTimeouts(BaseModel):
    step: int = 15000
    navigation: int = 30000


class DefaultsUI(BaseModel):
    browser: Literal["chromium", "firefox", "webkit"] = "chromium"
    viewport: dict[str, int] = Field(default_factory=lambda: {"width": 1280, "height": 720})


class Defaults(BaseModel):
    baseUrl: str
    timeoutsMs: DefaultsTimeouts = Field(default_factory=DefaultsTimeouts)
    ui: DefaultsUI = Field(default_factory=DefaultsUI)


class TestSpec(BaseModel):
    id: str
    name: str
    type: Literal["ui", "api"] = "ui"
    startUrl: str | None = None
    tags: list[str] = Field(default_factory=list)
    severity: str | None = None
    steps: list[Step] = Field(default_factory=list)


class SuiteSpec(BaseModel):
    specVersion: str | None = "1.0"
    project: str | None = None
    defaults: Defaults
    variables: dict[str, Any] = Field(default_factory=dict)
    tests: list[TestSpec] = Field(default_factory=list)


class RunStatus(str, Enum):
    queued = "queued"
    running = "running"
    completed = "completed"
    failed = "failed"


class StepResult(BaseModel):
    id: str
    action: str
    ok: bool
    startedAt: str
    finishedAt: str
    error: str | None = None
    screenshotUrl: str | None = None
    savedAs: str | None = None


class TestResult(BaseModel):
    id: str
    name: str
    type: Literal["ui", "api"]
    ok: bool
    steps: list[StepResult] = Field(default_factory=list)


class RunResult(BaseModel):
    runId: str
    status: RunStatus
    createdAt: str
    startedAt: str | None = None
    finishedAt: str | None = None
    current: dict[str, Any] | None = None  # {testId, stepId, stepIndex}
    suite: dict[str, Any] | None = None
    results: list[TestResult] | None = None
    error: str | None = None

