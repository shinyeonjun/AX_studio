from __future__ import annotations

import os
from pathlib import Path


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
