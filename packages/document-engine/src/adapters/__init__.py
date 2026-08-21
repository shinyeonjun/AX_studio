from __future__ import annotations

from pathlib import Path
from typing import Any

from adapters.base import DocumentParserAdapter
from adapters.basic import BasicAdapter


def docling_available() -> bool:
    try:
        import docling.document_converter  # noqa: F401

        return True
    except Exception:
        return False


def resolve_adapter(engine: str) -> DocumentParserAdapter:
    normalized = (engine or "auto").strip().lower()
    if normalized not in {"auto", "basic", "docling"}:
        raise ValueError(f"unsupported_engine:{engine}")
    if normalized == "docling":
        from adapters.docling import DoclingAdapter

        return DoclingAdapter()
    if normalized == "auto" and docling_available():
        from adapters.docling import DoclingAdapter

        return DoclingAdapter()
    return BasicAdapter()
