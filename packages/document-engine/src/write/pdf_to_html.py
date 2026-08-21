from __future__ import annotations

import json
import shutil
from dataclasses import dataclass
from html import escape
from pathlib import Path
from typing import Any

from artifact_store import artifact_dir, sha256_file, utc_now_iso
from ax_paths import default_template_root
from ingest_options import normalize_ocr
from parser_config import parser_cache_fingerprint


@dataclass
class PdfToHtmlResult:
    template_id: str
    source_path: str
    artifact_path: str
    html_path: str
    original_pdf_path: str
    meta_path: str
    engine: str
    page_count: int
    html: str
    cached: bool = False


def _template_dir(template_root: Path, template_id: str) -> Path:
    return artifact_dir(template_root, template_id)


def _load_meta(meta_path: Path) -> dict[str, Any] | None:
    if not meta_path.is_file():
        return None
    try:
        return json.loads(meta_path.read_text(encoding="utf-8"))
    except Exception:
        return None


def _meta_usable(meta: dict[str, Any], *, source_hash: str, engine: str, ocr_mode: str) -> bool:
    if meta.get("sourceHash") != source_hash:
        return False
    if meta.get("engine") != engine:
        return False
    if meta.get("ocrMode") != ocr_mode:
        return False
    fingerprint = parser_cache_fingerprint()
    for key, value in fingerprint.items():
        if meta.get(key) != value:
            return False
    html_path = Path(str(meta.get("htmlPath") or ""))
    return html_path.is_file()


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

    adapter = DoclingAdapter()
    converter = adapter._build_converter(ocr_mode)
    result = converter.convert(str(source_path))
    doc = result.document
    export_html = getattr(doc, "export_to_html", None)
    if not callable(export_html):
        raise RuntimeError("docling_export_to_html_unavailable")
    html = export_html()
    if not isinstance(html, str) or not html.strip():
        raise RuntimeError("docling_export_to_html_empty")
    pages = getattr(doc, "pages", None) or {}
    page_count = len(pages) if isinstance(pages, dict) else 1
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


def convert_pdf_to_html(
    source_path: Path,
    template_root: Path,
    options: dict[str, Any] | None = None,
) -> PdfToHtmlResult:
    if not source_path.is_file():
        raise FileNotFoundError("file_not_found")

    opts = dict(options or {})
    engine = str(opts.get("engine") or "auto")
    ocr_mode = normalize_ocr(opts.get("ocr"))
    template_id = sha256_file(source_path)
    root = _template_dir(template_root, template_id)
    html_path = root / "template.html"
    original_pdf_path = root / "original.pdf"
    meta_path = root / "meta.json"

    existing = _load_meta(meta_path)
    resolved_engine = _resolve_engine(engine)
    if existing and _meta_usable(
        existing,
        source_hash=template_id,
        engine=resolved_engine,
        ocr_mode=ocr_mode,
    ):
        return PdfToHtmlResult(
            template_id=template_id,
            source_path=str(source_path),
            artifact_path=str(root),
            html_path=str(html_path),
            original_pdf_path=str(original_pdf_path),
            meta_path=str(meta_path),
            engine=str(existing.get("engine") or resolved_engine),
            page_count=int(existing.get("pageCount") or 1),
            html=html_path.read_text(encoding="utf-8"),
            cached=True,
        )

    html, page_count, used_engine = _convert_pdf_to_html(source_path, engine, ocr_mode)
    root.mkdir(parents=True, exist_ok=True)
    html_path.write_text(html, encoding="utf-8")
    if not original_pdf_path.exists() or sha256_file(original_pdf_path) != template_id:
        shutil.copy2(source_path, original_pdf_path)

    meta = {
        "templateId": template_id,
        "sourcePath": str(source_path),
        "sourceHash": template_id,
        "sourceName": source_path.name,
        "engine": used_engine,
        "ocrMode": ocr_mode,
        "pageCount": page_count,
        "artifactPath": str(root),
        "htmlPath": str(html_path),
        "originalPdfPath": str(original_pdf_path),
        "importedAt": utc_now_iso(),
        **parser_cache_fingerprint(),
    }
    meta_path.write_text(json.dumps(meta, ensure_ascii=False, indent=2), encoding="utf-8")

    return PdfToHtmlResult(
        template_id=template_id,
        source_path=str(source_path),
        artifact_path=str(root),
        html_path=str(html_path),
        original_pdf_path=str(original_pdf_path),
        meta_path=str(meta_path),
        engine=used_engine,
        page_count=page_count,
        html=html,
        cached=False,
    )
