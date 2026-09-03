from __future__ import annotations

from pathlib import Path
from typing import Any

from .ocr import _looks_like_garbage_ocr
from .runtime import (
    _item_image,
    _item_kind,
    _item_text,
    _page_index_from_item,
    _page_render_scale,
    _render_pdf_page,
    _save_page_image,
    _save_pil_image,
)

def _classify_page(
    page_index: int,
    native_text: str,
    image_count: int,
    table_count: int,
    empty_table_count: int,
) -> str:
    text = native_text.strip()
    if empty_table_count > 0 and len(text) >= 80:
        return "mixed"
    if image_count > 0 and len(text) >= 120:
        return "mixed"
    if image_count > 0:
        return "image"
    if not text or len(text) < 24 or _looks_like_garbage_ocr(text):
        return "scan"
    if table_count > 0 and image_count > 0:
        return "mixed"
    return "native"

def _extract_docling_structure(
    doc: Any,
    images_dir: Path | None = None,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], dict[int, int], dict[int, int], dict[int, int]]:
    pages: dict[int, dict[str, Any]] = {}
    chunks: list[dict[str, Any]] = []
    tables: list[dict[str, Any]] = []
    images: list[dict[str, Any]] = []
    page_image_counts: dict[int, int] = {}
    page_table_counts: dict[int, int] = {}
    page_empty_table_counts: dict[int, int] = {}
    chunk_index = 0

    iterate = getattr(doc, "iterate_items", None)
    if callable(iterate):
        for item, _level in iterate():
            kind = _item_kind(item)
            page_index = _page_index_from_item(item)
            text = _item_text(item, doc)

            if kind == "image":
                page_image_counts[page_index] = page_image_counts.get(page_index, 0) + 1
                image_id = f"img{len(images)}"
                image_entry: dict[str, Any] = {"id": image_id, "pageIndex": page_index}
                if images_dir is not None:
                    dest = images_dir / f"{image_id}.png"
                    image = _item_image(item, doc)
                    if image is not None and _save_pil_image(image, dest):
                        image_entry["path"] = str(dest)
                images.append(image_entry)
                pages.setdefault(
                    page_index,
                    {"index": page_index, "hasVisual": False, "ocrConfidence": None, "textParts": []},
                )
                if not text:
                    continue

            if kind == "table":
                page_table_counts[page_index] = page_table_counts.get(page_index, 0) + 1
                table_text = text[:500]
                if not table_text.strip():
                    page_empty_table_counts[page_index] = page_empty_table_counts.get(page_index, 0) + 1
                tables.append({"id": f"tbl{len(tables)}", "pageIndex": page_index, "text": table_text})

            if not text:
                continue

            chunks.append(
                {
                    "id": f"c{chunk_index}",
                    "pageIndex": page_index,
                    "kind": kind,
                    "text": text,
                    "sourceType": "native",
                }
            )
            chunk_index += 1

            page = pages.setdefault(
                page_index,
                {"index": page_index, "hasVisual": False, "ocrConfidence": None, "textParts": []},
            )
            page["textParts"].append(text)

    if not chunks:
        export_md = doc.export_to_markdown()
        page_count = max(len(getattr(doc, "pages", {}) or {}), 1)
        for index in range(page_count):
            pages[index] = {"index": index, "hasVisual": False, "ocrConfidence": None, "textParts": []}
        chunks.append({"id": "c0", "pageIndex": 0, "kind": "document", "text": export_md, "sourceType": "native"})
    else:
        doc_pages = getattr(doc, "pages", None) or {}
        if isinstance(doc_pages, dict):
            for page_no in doc_pages.keys():
                try:
                    index = max(int(page_no) - 1, 0)
                except (TypeError, ValueError):
                    continue
                pages.setdefault(index, {"index": index, "hasVisual": False, "ocrConfidence": None, "textParts": []})

    page_list: list[dict[str, Any]] = []
    for index in sorted(pages.keys()):
        entry = pages[index]
        text_parts = entry.pop("textParts", [])
        native_text = "\n\n".join(text_parts).strip()
        source_type = _classify_page(
            index,
            native_text,
            page_image_counts.get(index, 0),
            page_table_counts.get(index, 0),
            page_empty_table_counts.get(index, 0),
        )
        entry["sourceType"] = source_type
        entry["text"] = native_text or None
        entry["ocrApplied"] = False
        entry["imagePath"] = None
        entry["hasVisual"] = source_type in {"image", "scan", "mixed"}
        page_list.append(entry)

    return page_list, chunks, tables, images, page_image_counts, page_table_counts, page_empty_table_counts

def _ensure_visual_page_images(
    doc: Any,
    pages: list[dict[str, Any]],
    images: list[dict[str, Any]],
    images_dir: Path,
    source_path: Path,
) -> None:
    for page in pages:
        if page.get("sourceType") not in {"image", "scan", "mixed"}:
            continue
        index = int(page["index"])
        page_path = _save_page_image(
            doc,
            index,
            images_dir,
            source_path,
            scale=_page_render_scale(page),
            prefer_pdf_render=str(page.get("sourceType") or "") == "scan",
        )
        if page_path:
            page["imagePath"] = page_path
        for image in images:
            if int(image.get("pageIndex", -1)) == index and image.get("path"):
                page["imagePath"] = page["imagePath"] or str(image["path"])
        if not any(image.get("pageIndex") == index and image.get("path") for image in images):
            if page_path:
                images.append({"id": f"page{index}", "pageIndex": index, "path": page_path})
