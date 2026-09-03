"""Focused implementation modules behind the stable PDF form seam."""

from .analysis import _ocr_candidate_fields, _ocr_geometry_fields, analyze_pdf_form
from .fill import fill_pdf_form
from .primitives import PdfPageGeometry
from .template import persist_pdf_form_template

__all__ = [
    "PdfPageGeometry",
    "analyze_pdf_form",
    "fill_pdf_form",
    "persist_pdf_form_template",
]
