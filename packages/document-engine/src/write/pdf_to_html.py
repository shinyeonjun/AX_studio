"""Stable public seam for PDF-to-HTML template conversion.

The implementation lives in the write.pdf_to_html_engine package. This
module keeps the worker and existing tests independent from its internal
layout.
"""

from .pdf_to_html_engine.cache import (
    _load_meta,
    _meta_usable,
    _template_dir,
)
from .pdf_to_html_engine.contracts import (
    PdfToHtmlResult,
    _PDF_HTML_FORMAT_VERSION,
    _ROUNDTRIP_PRINT_STYLE,
)
from .pdf_to_html_engine.convert import convert_pdf_to_html
from .pdf_to_html_engine.engines import (
    _basic_pdf_to_html,
    _convert_pdf_to_html,
    _docling_pdf_to_html,
    _resolve_engine,
)
from .pdf_to_html_engine.roundtrip import (
    _has_html_content,
    _html_styles,
    _page_source_images,
    _pdf_image_html,
    _roundtrip_html,
    _tag_content,
)
