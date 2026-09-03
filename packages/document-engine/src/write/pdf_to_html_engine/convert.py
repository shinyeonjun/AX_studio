from __future__ import annotations

import json
import shutil
from pathlib import Path
from typing import Any

from artifact_store import sha256_file, utc_now_iso
from ingest_options import normalize_ocr
from parser_config import parser_cache_fingerprint

from .cache import _load_meta, _meta_usable, _template_dir
from .contracts import PdfToHtmlResult, _PDF_HTML_FORMAT_VERSION
from .engines import _convert_pdf_to_html, _resolve_engine


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
    if used_engine == "docling":
        meta.update(
            {
                "htmlEditable": True,
                "htmlFormatVersion": _PDF_HTML_FORMAT_VERSION,
                "htmlImageMode": "embedded",
                "htmlPageMode": "per-page",
                "printPageSize": "A4",
            }
        )
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
