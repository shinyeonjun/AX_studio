from __future__ import annotations

from pathlib import Path
from typing import Any

from artifact_store import artifact_dir, sha256_file, utc_now_iso, write_manifest
from adapters.base import DocumentParserAdapter, IngestResult


def _read_text_file(path: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    text = path.read_text(encoding="utf-8", errors="replace")
    pages = [{"index": 0, "hasVisual": False, "ocrConfidence": None}]
    chunks = [
        {
            "id": "c0",
            "pageIndex": 0,
            "kind": "paragraph",
            "text": text,
        }
    ]
    return pages, chunks


def _read_pdf(path: Path) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[int]]:
    from pypdf import PdfReader

    reader = PdfReader(str(path))
    pages: list[dict[str, Any]] = []
    chunks: list[dict[str, Any]] = []
    visual_pages: list[int] = []

    for index, page in enumerate(reader.pages):
        text = (page.extract_text() or "").strip()
        has_visual = len(text) < 32
        pages.append(
            {
                "index": index,
                "hasVisual": has_visual,
                "ocrConfidence": None if text else 0.0,
            }
        )
        if has_visual:
            visual_pages.append(index)
        chunks.append(
            {
                "id": f"c{index}",
                "pageIndex": index,
                "kind": "page",
                "text": text,
            }
        )

    return pages, chunks, visual_pages


class BasicAdapter(DocumentParserAdapter):
    name = "basic"

    def ingest(self, source_path: Path, artifact_root: Path, options: dict[str, Any]) -> IngestResult:
        document_id = sha256_file(source_path)
        suffix = source_path.suffix.lower()

        tables: list[dict[str, Any]] = []
        images: list[dict[str, Any]] = []
        visual_pages: list[int] = []

        if suffix == ".pdf":
            pages, chunks, visual_pages = _read_pdf(source_path)
        elif suffix in {".txt", ".md", ".markdown", ".html", ".htm"}:
            pages, chunks = _read_text_file(source_path)
        else:
            raise ValueError(f"unsupported_format:{suffix or 'unknown'}")

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
