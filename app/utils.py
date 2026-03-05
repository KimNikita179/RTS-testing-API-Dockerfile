from __future__ import annotations

import re
from typing import Any, Mapping


_VAR_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


def deep_resolve(value: Any, variables: Mapping[str, Any]) -> Any:
    if isinstance(value, str):
        return resolve_string(value, variables)
    if isinstance(value, list):
        return [deep_resolve(v, variables) for v in value]
    if isinstance(value, dict):
        return {k: deep_resolve(v, variables) for k, v in value.items()}
    return value


def resolve_string(template: str, variables: Mapping[str, Any]) -> str:
    def _repl(m: re.Match[str]) -> str:
        key = m.group(1)
        if key not in variables:
            return m.group(0)
        v = variables[key]
        return "" if v is None else str(v)

    return _VAR_PATTERN.sub(_repl, template)


def ensure_relative_url(path_or_url: str) -> str:
    # В спецификации примеры используют "/login", "/api/health".
    # Если прислали абсолютный URL — оставляем как есть.
    if path_or_url.startswith("http://") or path_or_url.startswith("https://"):
        return path_or_url
    if not path_or_url.startswith("/"):
        return "/" + path_or_url
    return path_or_url

