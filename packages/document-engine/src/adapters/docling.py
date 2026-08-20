from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from artifact_store import artifact_dir, sha256_file, utc_now_iso, write_manifest
from adapters.base import DocumentParserAdapter, IngestResult
from ingest_options import normalize_ocr
from korean_ocr import build_docling_korean_ocr_options, ocr_image_path
from parser_config import parser_cache_fingerprint

_GARBAGE_OCR_RE = re.compile(r"[\u4e00-\u9fff\u053f\u00f4\u00e0\u00e2\u00f1\u00e3\u00e1]")
_AMOUNT_LINE_RE = re.compile(r"[\d,]+원")


def _page_index_from_item(item: Any) -> int:
    prov = getattr(item, "prov", None) or []
    if prov:
        page_no = getattr(prov[0], "page_no", None)
        if isinstance(page_no, int):
            return max(page_no - 1, 0)
    page_no = getattr(item, "page_no", None)
    if isinstance(page_no, int):
        return max(page_no - 1, 0)
    return 0


def _item_kind(item: Any, default: str = "paragraph") -> str:
    name = type(item).__name__
    if "Table" in name:
        return "table"
    if "Picture" in name or "Image" in name:
        return "image"
    if "SectionHeader" in name or "Title" in name:
        return "section"
    label = str(getattr(item, "label", "") or "").lower()
    if "table" in label:
        return "table"
    if "picture" in label or "figure" in label:
        return "image"
    if "title" in label or "header" in label or "section" in label:
        return "section"
    return default


def _item_text(item: Any, doc: Any) -> str:
    text = getattr(item, "text", None)
    if isinstance(text, str) and text.strip():
        return text.strip()

    if _item_kind(item) == "table":
        export_df = getattr(item, "export_to_dataframe", None)
        if callable(export_df):
            try:
                frame = export_df(doc=doc)
                return frame.to_markdown(index=False)
            except TypeError:
                try:
                    frame = export_df()
                    return frame.to_markdown(index=False)
                except Exception:
                    pass
            except Exception:
                pass

    return ""


def _save_pil_image(image: Any, dest: Path) -> bool:
    save = getattr(image, "save", None)
    if not callable(save):
        return False
    try:
        dest.parent.mkdir(parents=True, exist_ok=True)
        mode = getattr(image, "mode", None)
        if mode and mode not in {"RGB", "L"}:
            convert = getattr(image, "convert", None)
            if callable(convert):
                image = convert("RGB")
        save(dest, format="PNG")
        return dest.is_file() and dest.stat().st_size > 0
    except Exception:
        return False


def _item_image(item: Any, doc: Any) -> Any:
    getter = getattr(item, "get_image", None)
    if not callable(getter):
        return getattr(item, "image", None)
    try:
        return getter(doc)
    except TypeError:
        try:
            return getter()
        except Exception:
            return None
    except Exception:
        return None


def _page_image(doc: Any, page_index: int) -> Any:
    pages = getattr(doc, "pages", None) or {}
    if not isinstance(pages, dict):
        return None
    page = pages.get(page_index + 1)
    if page is None:
        page = pages.get(page_index)
    if page is None:
        return None
    getter = getattr(page, "get_image", None)
    if callable(getter):
        try:
            return getter(doc)
        except TypeError:
            try:
                return getter()
            except Exception:
                return getattr(page, "image", None)
        except Exception:
            return getattr(page, "image", None)
    return getattr(page, "image", None)


def _looks_like_garbage_ocr(text: str) -> bool:
    stripped = text.strip()
    if not stripped:
        return False
    if _GARBAGE_OCR_RE.search(stripped):
        return True
    hangul = len(re.findall(r"[가-힣]", stripped))
    return hangul < max(3, len(stripped) // 8) and len(stripped) > 20


def _render_pdf_page(source_path: Path, page_index: int, dest: Path, *, scale: float = 2.0) -> bool:
    document = None
    try:
        import pypdfium2 as pdfium

        document = pdfium.PdfDocument(str(source_path))
        page = document[page_index]
        bitmap = page.render(scale=scale)
        image = bitmap.to_pil()
        return _save_pil_image(image, dest)
    except Exception:
        return False
    finally:
        if document is not None:
            close = getattr(document, "close", None)
            if callable(close):
                close()


def _table_like_ocr_excerpt(ocr_text: str) -> str:
    lines = [line.strip() for line in ocr_text.splitlines() if line.strip()]
    if not lines:
        return ""

    start = 0
    for index, line in enumerate(lines):
        if re.search(r"(CloudOps|정산서)", line):
            start = index
            break

    scoped = lines[start:]
    amount_indices = [index for index, line in enumerate(scoped) if _AMOUNT_LINE_RE.search(line)]
    if not amount_indices:
        return ""

    picked: list[str] = []
    seen: set[str] = set()
    for index in amount_indices:
        amount_line = scoped[index]
        if amount_line not in seen:
            seen.add(amount_line)
            picked.append(amount_line)
        if index == 0:
            continue
        label = scoped[index - 1]
        if label in seen:
            continue
        if len(label) > 48 or re.search(r"(메모|확인|테스트|질문)", label):
            continue
        if _AMOUNT_LINE_RE.search(label):
            continue
        seen.add(label)
        picked.insert(len(picked) - 1, label)

    if start > 0 and lines[start] not in seen:
        picked.insert(0, lines[start])
    return "\n".join(picked)


def _backfill_empty_tables(tables: list[dict[str, Any]], images: list[dict[str, Any]]) -> None:
    ocr_by_page: dict[int, list[str]] = {}
    for image in images:
        page_index = int(image.get("pageIndex", -1))
        ocr_text = str(image.get("ocrText") or "").strip()
        if ocr_text:
            ocr_by_page.setdefault(page_index, []).append(ocr_text)

    for table in tables:
        if str(table.get("text") or "").strip():
            continue
        page_index = int(table.get("pageIndex", -1))
        for ocr_text in ocr_by_page.get(page_index, []):
            excerpt = _table_like_ocr_excerpt(ocr_text)
            if len(excerpt) >= 20:
                table["text"] = excerpt
                table["sourceType"] = "ocr"
                break


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


def _save_page_image(
    doc: Any,
    page_index: int,
    images_dir: Path,
    source_path: Path,
    *,
    scale: float = 2.0,
    prefer_pdf_render: bool = False,
) -> str | None:
    dest = images_dir / f"page{page_index}.png"
    if not prefer_pdf_render:
        image = _page_image(doc, page_index)
        if image is not None and _save_pil_image(image, dest):
            return str(dest)
    if _render_pdf_page(source_path, page_index, dest, scale=scale):
        return str(dest)
    return None


def _page_render_scale(page: dict[str, Any]) -> float:
    if str(page.get("sourceType") or "") == "scan":
        return 3.0
    return 2.0


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


def _apply_korean_ocr(
    pages: list[dict[str, Any]],
    chunks: list[dict[str, Any]],
    images: list[dict[str, Any]],
    ocr_mode: str,
    chunk_index_start: int,
) -> tuple[list[int], list[int], int]:
    visual_pages: list[int] = []
    ocr_pages: list[int] = []
    chunk_index = chunk_index_start

    for page in pages:
        index = int(page["index"])
        source_type = str(page.get("sourceType") or "native")
        if source_type in {"image", "scan", "mixed"}:
            visual_pages.append(index)

        if ocr_mode == "off":
            continue
        if ocr_mode == "auto" and source_type == "native":
            continue
        if ocr_mode == "auto" and source_type == "image":
            continue

        if source_type == "scan":
            image_path = page.get("imagePath")
            if not image_path:
                continue
            text, confidence = ocr_image_path(Path(str(image_path)))
            if text:
                page["text"] = text
                page["ocrApplied"] = True
                page["ocrConfidence"] = confidence
                chunks.append(
                    {
                        "id": f"c{chunk_index}",
                        "pageIndex": index,
                        "kind": "ocr_page",
                        "text": text,
                        "sourceType": "ocr",
                    }
                )
                chunk_index += 1
                ocr_pages.append(index)
            continue

        if source_type == "mixed":
            page_ocr_applied = False
            for image in images:
                if int(image.get("pageIndex", -1)) != index:
                    continue
                image_path = image.get("path")
                if not image_path:
                    continue
                text, confidence = ocr_image_path(Path(str(image_path)))
                if not text:
                    continue
                image["ocrText"] = text
                image["ocrConfidence"] = confidence
                chunks.append(
                    {
                        "id": f"c{chunk_index}",
                        "pageIndex": index,
                        "kind": "ocr_image",
                        "text": text,
                        "sourceType": "ocr",
                        "imageId": image.get("id"),
                    }
                )
                chunk_index += 1
                page_ocr_applied = True
            if not page_ocr_applied:
                image_path = page.get("imagePath")
                if image_path:
                    text, confidence = ocr_image_path(Path(str(image_path)))
                    if text:
                        page["ocrApplied"] = True
                        page["ocrConfidence"] = confidence
                        chunks.append(
                            {
                                "id": f"c{chunk_index}",
                                "pageIndex": index,
                                "kind": "ocr_image",
                                "text": text,
                                "sourceType": "ocr",
                            }
                        )
                        chunk_index += 1
                        page_ocr_applied = True
            if page_ocr_applied:
                page["ocrApplied"] = True
                ocr_pages.append(index)
            continue

        if ocr_mode == "force" and source_type == "image":
            image_path = page.get("imagePath")
            if not image_path:
                continue
            text, confidence = ocr_image_path(Path(str(image_path)))
            if text:
                chunks.append(
                    {
                        "id": f"c{chunk_index}",
                        "pageIndex": index,
                        "kind": "ocr_image",
                        "text": text,
                        "sourceType": "ocr",
                    }
                )
                chunk_index += 1
                page["ocrApplied"] = True
                page["ocrConfidence"] = confidence
                ocr_pages.append(index)

    return sorted(set(visual_pages)), sorted(set(ocr_pages)), chunk_index


class DoclingAdapter(DocumentParserAdapter):
    name = "docling"

    def _build_converter(self, ocr_mode: str):
        from docling.datamodel.base_models import InputFormat
        from docling.datamodel.pipeline_options import OcrMode, PdfPipelineOptions
        from docling.document_converter import DocumentConverter, PdfFormatOption

        pipeline_options = PdfPipelineOptions()
        pipeline_options.generate_picture_images = True
        pipeline_options.generate_page_images = True

        if ocr_mode == "off":
            pipeline_options.do_ocr = False
        elif ocr_mode == "force":
            pipeline_options.do_ocr = True
            pipeline_options.images_scale = 2.0
            pipeline_options.ocr_options = build_docling_korean_ocr_options()
            pipeline_options.ocr_options.mode = OcrMode.FULL_PAGE
        else:
            # auto: native extraction first; Korean OCR runs only on scan/mixed pages afterward.
            pipeline_options.do_ocr = False

        return DocumentConverter(
            format_options={InputFormat.PDF: PdfFormatOption(pipeline_options=pipeline_options)},
        )

    def ingest(self, source_path: Path, artifact_root: Path, options: dict[str, Any]) -> IngestResult:
        document_id = sha256_file(source_path)
        ocr_mode = normalize_ocr(options.get("ocr"))
        converter = self._build_converter(ocr_mode)
        result = converter.convert(str(source_path))
        doc = result.document
        images_dir = artifact_dir(artifact_root, document_id) / "images"

        pages, chunks, tables, images, _image_counts, _table_counts, _empty_table_counts = _extract_docling_structure(
            doc,
            images_dir,
        )
        _ensure_visual_page_images(doc, pages, images, images_dir, source_path)
        chunk_index = len(chunks)
        visual_pages, ocr_pages, chunk_index = _apply_korean_ocr(
            pages,
            chunks,
            images,
            ocr_mode,
            chunk_index,
        )
        _backfill_empty_tables(tables, images)

        summary = {
            "pageCount": len(pages),
            "chunkCount": chunk_index,
            "tableCount": len(tables),
            "imageCount": len(images),
            "visualPageCount": len(visual_pages),
            "visualPages": visual_pages,
            "ocrPageCount": len(ocr_pages),
            "ocrPages": ocr_pages,
            "engine": self.name,
        }

        manifest = {
            "documentId": document_id,
            "sourcePath": str(source_path),
            "sourceHash": document_id,
            "engine": self.name,
            "ocrMode": ocr_mode,
            "ingestedAt": utc_now_iso(),
            **parser_cache_fingerprint(),
            "summary": summary,
            "pages": pages,
            "chunks": chunks,
            "tables": tables,
            "images": images,
        }

        root = write_manifest(artifact_root, document_id, manifest)
        return IngestResult(
            document_id=document_id,
            artifact_path=str(root),
            engine=self.name,
            summary=summary,
            manifest=manifest,
        )
