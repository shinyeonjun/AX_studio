from __future__ import annotations

from html import escape
from pathlib import Path
from typing import Any

from .roundtrip import _roundtrip_html


def _resolve_engine(requested: str) -> str:
    normalized = str(requested or "auto").lower()
    if normalized == "docling":
        return "docling"
    if normalized == "basic":
        return "basic"
    try:
        from adapters import docling_available

        return "docling" if docling_available() else "basic"
    except Exception:
        return "basic"


def _docling_pdf_to_html(source_path: Path, ocr_mode: str) -> tuple[str, int]:
    from adapters.docling import DoclingAdapter
    from pypdf import PdfReader

    adapter = DoclingAdapter()
    converter = adapter._build_converter(ocr_mode)
    result = converter.convert(str(source_path))
    doc = result.document
    # The source PDF is the authority for page count. Docling can omit an
    # image-only/blank page from its document page map even though that page
    # must still survive an editable HTML -> PDF round trip.
    page_count = max(len(PdfReader(str(source_path)).pages), 1)
    html = _roundtrip_html(source_path, doc, page_count)
    if not isinstance(html, str) or not html.strip():
        raise RuntimeError("docling_export_to_html_empty")
    return html, max(page_count, 1)


def _basic_pdf_to_html(source_path: Path) -> tuple[str, int]:
    from pypdf import PdfReader

    reader = PdfReader(str(source_path))
    sections: list[str] = []
    for index, page in enumerate(reader.pages):
        text = (page.extract_text() or "").strip()
        body = escape(text).replace("\n", "<br/>\n") if text else "&nbsp;"
        sections.append(f'<section class="page" data-page-index="{index}"><pre>{body}</pre></section>')
    html = (
        "<!DOCTYPE html>\n"
        '<html lang="ko">\n<head>\n<meta charset="utf-8"/>\n'
        f"<title>{escape(source_path.stem)}</title>\n</head>\n<body>\n"
        + "\n".join(sections)
        + "\n</body>\n</html>"
    )
    return html, max(len(reader.pages), 1)


def _convert_pdf_to_html(source_path: Path, engine: str, ocr_mode: str) -> tuple[str, int, str]:
    resolved = _resolve_engine(engine)
    if resolved == "docling":
        try:
            html, page_count = _docling_pdf_to_html(source_path, ocr_mode)
            return html, page_count, "docling"
        except Exception:
            if engine == "docling":
                raise
            html, page_count = _basic_pdf_to_html(source_path)
            return html, page_count, "basic"
    html, page_count = _basic_pdf_to_html(source_path)
    return html, page_count, "basic"
