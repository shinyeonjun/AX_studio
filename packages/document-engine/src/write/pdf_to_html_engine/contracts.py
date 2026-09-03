from __future__ import annotations

from dataclasses import dataclass


@dataclass
class PdfToHtmlResult:
    template_id: str
    source_path: str
    artifact_path: str
    html_path: str
    original_pdf_path: str
    meta_path: str
    engine: str
    page_count: int
    html: str
    cached: bool = False


_PDF_HTML_FORMAT_VERSION = "roundtrip-v2"


_ROUNDTRIP_PRINT_STYLE = """
<style id="ax-studio-pdf-roundtrip">
@page { size: A4 portrait; margin: 0; }
html, body {
    margin: 0 !important;
    padding: 0 !important;
    max-width: none !important;
    background: #fff !important;
    box-shadow: none !important;
}
.ax-pdf-page {
    box-sizing: border-box !important;
    width: 210mm !important;
    min-height: 297mm !important;
    margin: 0 !important;
    padding: 16mm !important;
    background: #fff !important;
    break-after: page;
    page-break-after: always;
}
.ax-pdf-page:last-child {
    break-after: auto;
    page-break-after: auto;
}
.ax-pdf-page img {
    max-width: 100%;
    height: auto;
}
.ax-pdf-page figure {
    margin: 1rem 0;
    text-align: center;
}
.ax-source-image img {
    max-height: 250mm;
    object-fit: contain;
}
.ax-empty-page {
    min-height: 260mm;
}
@media screen {
    html { background: #e1e1e1 !important; }
    .ax-pdf-page {
        margin: 16px auto !important;
        box-shadow: 0 0 10px rgba(0, 0, 0, 0.18) !important;
    }
}
@media print {
    .ax-pdf-page { box-shadow: none !important; }
}
</style>
"""
