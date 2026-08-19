from __future__ import annotations

from pathlib import Path
from typing import Any

from artifact_store import sha256_file, utc_now_iso, write_manifest
from adapters.base import DocumentParserAdapter, IngestResult


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


def _extract_docling_structure(doc: Any) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]], list[int]]:
    pages: dict[int, dict[str, Any]] = {}
    chunks: list[dict[str, Any]] = []
    tables: list[dict[str, Any]] = []
    images: list[dict[str, Any]] = []
    visual_pages: set[int] = set()
    chunk_index = 0

    iterate = getattr(doc, "iterate_items", None)
    if callable(iterate):
        for item, _level in iterate():
            kind = _item_kind(item)
            page_index = _page_index_from_item(item)
            text = _item_text(item, doc)

            if kind == "image":
                visual_pages.add(page_index)
                images.append({"id": f"img{len(images)}", "pageIndex": page_index})
                if not text:
                    continue

            if kind == "table":
                tables.append({"id": f"tbl{len(tables)}", "pageIndex": page_index, "text": text[:500]})

            if not text:
                continue

            chunks.append(
                {
                    "id": f"c{chunk_index}",
                    "pageIndex": page_index,
                    "kind": kind,
                    "text": text,
                }
            )
            chunk_index += 1

            page = pages.setdefault(
                page_index,
                {"index": page_index, "hasVisual": False, "ocrConfidence": None, "textParts": []},
            )
            page["textParts"].append(text)
            if kind in {"image", "table"} or len(text.strip()) < 32:
                page["hasVisual"] = True
                visual_pages.add(page_index)

    if not chunks:
        export_md = doc.export_to_markdown()
        page_count = max(len(getattr(doc, "pages", {}) or {}), 1)
        for index in range(page_count):
            pages[index] = {"index": index, "hasVisual": False, "ocrConfidence": None, "textParts": []}
        chunks.append({"id": "c0", "pageIndex": 0, "kind": "document", "text": export_md})
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
        entry["text"] = "\n\n".join(text_parts).strip() if text_parts else None
        page_list.append(entry)

    if not page_list:
        page_list = [{"index": 0, "hasVisual": False, "ocrConfidence": None, "text": None}]

    return page_list, chunks, tables, images, sorted(visual_pages)


class DoclingAdapter(DocumentParserAdapter):
    name = "docling"

    def ingest(self, source_path: Path, artifact_root: Path, options: dict[str, Any]) -> IngestResult:
        from docling.document_converter import DocumentConverter

        document_id = sha256_file(source_path)
        converter = DocumentConverter()
        result = converter.convert(str(source_path))
        doc = result.document

        pages, chunks, tables, images, visual_pages = _extract_docling_structure(doc)

        summary = {
            "pageCount": len(pages),
            "chunkCount": len(chunks),
            "tableCount": len(tables),
            "imageCount": len(images),
            "visualPageCount": len(visual_pages),
            "visualPages": visual_pages,
            "engine": self.name,
        }

        manifest = {
            "documentId": document_id,
            "sourcePath": str(source_path),
            "sourceHash": document_id,
            "engine": self.name,
            "ingestedAt": utc_now_iso(),
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
