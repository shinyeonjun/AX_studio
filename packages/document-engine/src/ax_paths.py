from __future__ import annotations

import os
from pathlib import Path
from typing import Any


def default_ax_data_root() -> Path:
    from_env = os.environ.get("AX_DATA_ROOT", "").strip()
    if from_env:
        return Path(from_env)
    local = os.environ.get("LOCALAPPDATA")
    if local:
        return Path(local) / "AXStudio"
    return Path.home() / ".ax-studio"


def default_document_root() -> Path:
    override = os.environ.get("AX_DOCUMENT_ARTIFACT_ROOT", "").strip()
    if override:
        return Path(override)
    return default_ax_data_root() / "documents"


def default_template_root() -> Path:
    override = os.environ.get("AX_TEMPLATE_ROOT", "").strip()
    if override:
        return Path(override)
    return default_ax_data_root() / "templates"


def _resolve_request_path(value: object, label: str) -> Path:
    if isinstance(value, Path):
        path = value.expanduser().resolve()
    elif isinstance(value, str) and value.strip():
        path = Path(value).expanduser().resolve()
    else:
        raise ValueError(f"{label}_path_required")
    if len(str(path)) > 4096:
        raise ValueError(f"{label}_path_too_long")
    return path


def request_allowed_paths(params: dict[str, Any]) -> set[Path]:
    raw = params.get("allowedPaths")
    if not isinstance(raw, list) or not raw:
        raise ValueError("allowed_paths_required")
    return {_resolve_request_path(value, "allowed") for value in raw}


def request_allowed_roots(params: dict[str, Any]) -> set[Path]:
    raw = params.get("allowedRoots")
    if not isinstance(raw, list) or not raw:
        raise ValueError("allowed_roots_required")
    return {_resolve_request_path(value, "allowed") for value in raw}


def managed_request_path(
    value: object,
    label: str,
    allowed_paths: set[Path],
) -> Path:
    path = _resolve_request_path(value, label)
    if path not in allowed_paths:
        raise ValueError(f"{label}_path_not_allowed")
    return path


def managed_request_root(
    value: object,
    default: Path,
    label: str,
    params: dict[str, Any],
) -> Path:
    root = _resolve_request_path(value if value is not None else default, label)
    if value is not None and root not in request_allowed_roots(params):
        raise ValueError(f"{label}_root_not_allowed")
    return root
