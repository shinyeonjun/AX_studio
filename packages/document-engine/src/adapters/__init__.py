from __future__ import annotations

from pathlib import Path
from typing import Any

from adapters.base import DocumentParserAdapter
from adapters.basic import BasicAdapter


def resolve_adapter(engine: str) -> DocumentParserAdapter:
    normalized = (engine or "auto").lower()
    if normalized in {"docling", "auto"}:
        try:
            from adapters.docling import DoclingAdapter

            return DoclingAdapter()
        except Exception:
            if normalized == "docling":
                raise
    return BasicAdapter()
