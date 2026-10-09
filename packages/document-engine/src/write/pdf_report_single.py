"""One completed report, no blank form: list its text, then erase the chosen values.

The host decides which text is a value (it changes every period) and which is the form (titles,
labels, column headers). Erasing those values gives the blank form the pair analysis expects, so a
person can hand over last month's report alone.
"""
from __future__ import annotations

import hashlib
from pathlib import Path
from typing import Any, Mapping

from pypdf import PdfReader, PdfWriter

from .pdf_form_engine.placeholders import remove_text_in_regions
from .pdf_read import inspect_pages
from .pdf_report import _render_pages, _sha256

_MAX_SPANS = 2_000


def _span_id(page_index: int, index: int, rect: tuple[float, ...]) -> str:
    identity = f"{page_index}:{index}:" + ",".join(f"{value:.2f}" for value in rect)
    return "span-" + hashlib.sha256(identity.encode("utf-8")).hexdigest()[:16]


def list_report_spans(example_path: Path, artifact_root: Path) -> dict[str, Any]:
    """Every text piece of the report with its page and box (top-left coordinates), plus page images."""
    if not example_path.is_file():
        raise ValueError("report_example_file_not_found")
    example_hash = _sha256(example_path)
    pages = inspect_pages(example_path)
    spans: list[dict[str, Any]] = []
    for page_index, page in enumerate(pages):
        for index, span in enumerate(page.spans):
            x0, y0, x1, y1 = (round(float(value), 3) for value in span["bbox"][:4])
            spans.append({
                "id": _span_id(page_index, index, (x0, y0, x1, y1)),
                "pageIndex": page_index,
                "text": span["text"],
                "rect": {"x": x0, "y": y0, "width": round(x1 - x0, 3), "height": round(y1 - y0, 3)},
                "fontSize": span["size"],
            })
            if len(spans) > _MAX_SPANS:
                raise ValueError("report_example_too_much_text")
    target = artifact_root / "report-singles" / example_hash[:2] / example_hash
    return {
        "schemaVersion": 1,
        "exampleHash": example_hash,
        "pageCount": len(pages),
        "pages": [
            {"index": index, "width": round(page.width, 3), "height": round(page.height, 3), "rotation": page.rotation}
            for index, page in enumerate(pages)
        ],
        "spans": spans,
        "exampleImages": _render_pages(example_path, target, "example"),
    }


def blank_report_template(
    example_path: Path,
    removals: list[Mapping[str, Any]],
    output_path: Path,
) -> dict[str, Any]:
    """Write the report with each removal's text taken out of its box; nothing is painted over."""
    if not example_path.is_file():
        raise ValueError("report_example_file_not_found")
    if not removals:
        raise ValueError("report_values_required")
    by_page: dict[int, list[Mapping[str, Any]]] = {}
    for removal in removals:
        rect = removal.get("rect")
        text = removal.get("text")
        page_index = removal.get("pageIndex")
        if not isinstance(rect, Mapping) or not isinstance(text, str) or not isinstance(page_index, int):
            raise ValueError("report_value_removal_invalid")
        by_page.setdefault(page_index, []).append(removal)
    writer = PdfWriter(clone_from=PdfReader(example_path))
    for page_index, page_removals in by_page.items():
        if page_index < 0 or page_index >= len(writer.pages):
            raise ValueError(f"report_value_page_not_found:{page_index}")
        remove_text_in_regions(writer.pages[page_index], writer, page_removals)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("wb") as stream:
        writer.write(stream)
    return {"schemaVersion": 1, "templatePath": str(output_path), "removedCount": len(removals)}
