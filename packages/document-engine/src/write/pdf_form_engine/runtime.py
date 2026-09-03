from __future__ import annotations

from typing import Any, Mapping

from .primitives import _as_float

def _pymupdf() -> Any:
    """Load the PDF writer behind the format-neutral form contract.

    PyMuPDF renamed its import module from the historical ``fitz`` name. Keep
    the fallback so a compatible older runtime can still execute a persisted
    template while the packaged runtime uses the canonical import.
    """
    try:
        import pymupdf

        return pymupdf
    except ImportError:
        try:
            import fitz

            return fitz
        except ImportError as error:
            raise RuntimeError("pymupdf_required") from error

def _pymupdf_rect(pdf: Any, raw_rect: Mapping[str, Any]) -> Any:
    x = _as_float(raw_rect.get("x"))
    y = _as_float(raw_rect.get("y"))
    width = _as_float(raw_rect.get("width"))
    height = _as_float(raw_rect.get("height"))
    return pdf.Rect(x, y, x + width, y + height)
