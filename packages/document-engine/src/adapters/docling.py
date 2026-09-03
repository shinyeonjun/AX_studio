"""Stable external seam for the Docling document parser adapter.

The implementation is organized under ``adapters.docling_engine`` so callers
only depend on the adapter and its established helper seams.
"""

from .docling_engine import DoclingAdapter
from .docling_engine.ocr import (
    _apply_korean_ocr,
    _backfill_empty_tables,
    _looks_like_garbage_ocr,
    _table_like_ocr_excerpt,
)
from .docling_engine.runtime import (
    _item_image,
    _item_kind,
    _item_text,
    _page_image,
    _page_index_from_item,
    _page_render_scale,
    _render_pdf_page,
    _save_page_image,
    _save_pil_image,
)
from .docling_engine.structure import (
    _classify_page,
    _ensure_visual_page_images,
    _extract_docling_structure,
)

__all__ = [
    "DoclingAdapter",
    "_apply_korean_ocr",
    "_backfill_empty_tables",
    "_classify_page",
    "_ensure_visual_page_images",
    "_extract_docling_structure",
    "_item_image",
    "_item_kind",
    "_item_text",
    "_looks_like_garbage_ocr",
    "_page_image",
    "_page_index_from_item",
    "_page_render_scale",
    "_render_pdf_page",
    "_save_page_image",
    "_save_pil_image",
    "_table_like_ocr_excerpt",
]
