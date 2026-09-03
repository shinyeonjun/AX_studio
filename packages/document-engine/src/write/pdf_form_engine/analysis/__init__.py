from __future__ import annotations

from pathlib import Path
from typing import Any, Mapping

from artifact_store import sha256_file, utc_now_iso

from ..primitives import (
    PDF_FORM_SCHEMA_VERSION,
    PdfPageGeometry,
    _PLACEHOLDER_RE,
    _acroform_fields,
    _as_float,
    _as_string,
    _field_id,
    _page_geometries,
    _placeholder_fields_from_text,
)
from .digital import _digital_geometry_fields, _digital_placeholder_fields, _pdfium_page_text
from .hints import _normalize_hint
from .ocr import _ocr_fields
from .ocr_geometry import _cluster_positions, _ocr_geometry_fields
from .ocr_text import _ocr_candidate_fields, _ocr_items, _render_page


def analyze_pdf_form(source_path: Path, options: Mapping[str, Any] | None = None) -> dict[str, Any]:
    from pypdf import PdfReader

    if not source_path.is_file():
        raise FileNotFoundError("file_not_found")
    reader = PdfReader(str(source_path))
    pages = _page_geometries(reader)
    form_fields = _acroform_fields(reader, pages)
    fields = list(form_fields)
    warnings: list[str] = []
    engine = "acroform" if form_fields else "none"
    opts = dict(options or {})
    ocr_mode = _as_string(opts.get("ocr") or "auto").lower()
    if not form_fields:
        digital_fields, has_native_text = _digital_placeholder_fields(source_path, pages)
        fields.extend(digital_fields)
        if not digital_fields and has_native_text:
            fields.extend(_digital_geometry_fields(source_path, pages))
        if digital_fields:
            engine = "digital"
        elif has_native_text:
            engine = "digital"
            warnings.append("no_editable_placeholders_detected")
        should_ocr = ocr_mode == "force" or (ocr_mode == "auto" and not has_native_text)
        if should_ocr:
            ocr_fields, warning = _ocr_fields(source_path, pages)
            fields.extend(ocr_fields)
            if ocr_fields:
                engine = "ocr"
            if warning:
                warnings.append(warning)
    hints = opts.get("fieldHints")
    if isinstance(hints, list):
        for ordinal, hint in enumerate(hints):
            if not isinstance(hint, Mapping):
                continue
            normalized = _normalize_hint(hint, pages, ordinal)
            if normalized:
                fields.append(normalized)
        if hints and engine == "none":
            engine = "layout_hint"
    mode = "acroform" if form_fields else ("ocr" if engine == "ocr" else ("digital" if engine == "digital" else "overlay"))
    return {
        "schemaVersion": PDF_FORM_SCHEMA_VERSION,
        "templateId": sha256_file(source_path),
        "sourceName": source_path.name,
        "sourceHash": sha256_file(source_path),
        "pageCount": len(pages),
        "coordinateSpace": "pdf-user-top-left-unrotated",
        "engine": engine,
        "mode": mode,
        "requiresReview": any(float(field.get("confidence", 0.0)) < 0.9 for field in fields) or not fields,
        "warnings": warnings,
        "pages": [
            {
                "index": page.index,
                "width": page.width,
                "height": page.height,
                "rotation": page.rotation,
            }
            for page in pages
        ],
        "fields": fields,
        "createdAt": utc_now_iso(),
    }
