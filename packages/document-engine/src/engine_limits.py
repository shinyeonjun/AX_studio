"""Resource limits shared by every document-engine command.

Untrusted documents are parsed in-process, so size, page count and raster
dimensions are capped before any heavy parser or renderer touches them.
"""
from __future__ import annotations

import math
from pathlib import Path

MAX_SOURCE_BYTES = 100 * 1024 * 1024
MAX_SOURCE_PAGES = 300
# Largest raster we render for OCR/verification (~50 MP, about 200 MB as RGBA).
MAX_RENDER_PIXELS = 50_000_000


def configure_image_limits() -> None:
    """Make Pillow refuse decompression bombs well before they exhaust memory."""
    try:
        from PIL import Image
    except ImportError:
        return
    # Pillow warns above this and raises above twice this value.
    Image.MAX_IMAGE_PIXELS = MAX_RENDER_PIXELS


def clamp_render_scale(width_pt: float, height_pt: float, requested: float) -> float:
    """Largest scale <= ``requested`` keeping width*height*scale^2 <= MAX_RENDER_PIXELS."""
    area = max(float(width_pt), 1.0) * max(float(height_pt), 1.0)
    return max(min(float(requested), math.sqrt(MAX_RENDER_PIXELS / area)), 0.01)


def assert_source_within_limits(path: Path) -> None:
    """Reject oversized sources, and PDFs with more than MAX_SOURCE_PAGES pages."""
    try:
        size = path.stat().st_size
    except OSError as error:
        raise FileNotFoundError("file_not_found") from error
    if size > MAX_SOURCE_BYTES:
        raise ValueError("document_source_too_large")
    if path.suffix.lower() != ".pdf":
        return
    try:
        from pypdf import PdfReader
    except ImportError:
        return
    try:
        page_count = len(PdfReader(str(path), strict=False).pages)
    except Exception:
        # Unreadable PDFs are reported by the command's own parser.
        return
    if page_count > MAX_SOURCE_PAGES:
        raise ValueError("document_too_many_pages")
