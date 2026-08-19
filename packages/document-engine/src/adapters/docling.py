from __future__ import annotations

from pathlib import Path
from typing import Any

from artifact_store import sha256_file, utc_now_iso, write_manifest
from adapters.base import DocumentParserAdapter, IngestResult


class DoclingAdapter(DocumentParserAdapter):
    name = "docling"

    def ingest(self, source_path: Path, artifact_root: Path, options: dict[str, Any]) -> IngestResult:
        from docling.document_converter import DocumentConverter

        document_id = sha256_file(source_path)
        converter = DocumentConverter()
        result = converter.convert(str(source_path))
        doc = result.document

        pages: list[dict[str, Any]] = []
        chunks: list[dict[str, Any]] = []
        tables: list[dict[str, Any]] = []
        images: list[dict[str, Any]] = []
        visual_pages: list[int] = []

        export_md = doc.export_to_markdown()
        page_count = max(len(getattr(doc, "pages", []) or []), 1)

        for index in range(page_count):
            pages.append({"index": index, "hasVisual": False, "ocrConfidence": None})

        chunks.append(
            {
                "id": "c0",
                "pageIndex": 0,
                "kind": "document",
                "text": export_md,
            }
        )

        summary = {
            "pageCount": page_count,
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
