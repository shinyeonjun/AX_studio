"""Print a report's text as lines (JSON), from a PDF or a Word file: one line per text line or table row.

Usage: python extract.py <file>
"""
from __future__ import annotations

import json
import re
import sys
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "packages/document-engine/src"))


def pdf_lines(path: str) -> list[str]:
    from write.pdf_read import inspect_pages

    lines: list[str] = []
    for page in inspect_pages(Path(path)):
        rows: dict[int, list[tuple[float, str]]] = {}
        for span in page.spans:
            x0, y0, _, y1 = span["bbox"][:4]
            rows.setdefault(round((y0 + y1) / 4), []).append((x0, span["text"]))
        lines += [" ".join(text for _, text in sorted(items)) for _, items in sorted(rows.items())]
    return lines


def docx_lines(path: str) -> list[str]:
    with zipfile.ZipFile(path) as archive:
        names = sorted(name for name in archive.namelist() if re.match(r"word/(document|header\d*|footer\d*)\.xml$", name))
        lines: list[str] = []
        for name in names:
            xml = archive.read(name).decode("utf-8")
            for row in re.findall(r"<w:tr\b.*?</w:tr>", xml, re.S):
                cells = ["".join(re.findall(r"<w:t(?:\s[^>]*)?>([^<]*)</w:t>", cell)) for cell in re.findall(r"<w:tc\b.*?</w:tc>", row, re.S)]
                lines.append(" ".join(cells))
            outside = re.sub(r"<w:tbl\b.*?</w:tbl>", "", xml, flags=re.S)
            for paragraph in re.findall(r"<w:p\b.*?</w:p>", outside, re.S):
                lines.append("".join(re.findall(r"<w:t(?:\s[^>]*)?>([^<]*)</w:t>", paragraph)))
    return lines


if __name__ == "__main__":
    target = sys.argv[1]
    raw = docx_lines(target) if target.lower().endswith(".docx") else pdf_lines(target)
    lines = [re.sub(r"\s+", " ", line).strip() for line in raw]
    print(json.dumps([line for line in lines if line], ensure_ascii=False))
