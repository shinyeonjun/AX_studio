"""Stable public seam for generic PDF form analysis and writing.

The implementation lives in the ``write.pdf_form_engine`` package. This
module remains small so the worker and existing callers do not need to know
the internal layout.
"""

from .pdf_form_engine import (
    PdfPageGeometry,
    analyze_pdf_form,
    fill_pdf_form,
    persist_pdf_form_template,
)
from .pdf_form_engine.analysis import _ocr_candidate_fields, _ocr_geometry_fields
from .pdf_form_engine.fonts import _find_font_path
from .pdf_form_engine.primitives import _placeholder_fields_from_text

__all__ = [
    "PdfPageGeometry",
    "analyze_pdf_form",
    "fill_pdf_form",
    "persist_pdf_form_template",
    "_ocr_candidate_fields",
    "_ocr_geometry_fields",
    "_find_font_path",
    "_placeholder_fields_from_text",
]
