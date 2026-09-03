from __future__ import annotations

from pathlib import Path
from typing import Any

from adapters.base import DocumentParserAdapter, IngestResult
from artifact_store import artifact_dir, sha256_file, utc_now_iso, write_manifest
from ingest_options import normalize_ocr
from korean_ocr import build_docling_korean_ocr_options
from parser_config import parser_cache_fingerprint

from .ocr import _apply_korean_ocr, _backfill_empty_tables
from .structure import _ensure_visual_page_images, _extract_docling_structure

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
