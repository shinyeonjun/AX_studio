"""Draw a report model (shapes.mjs) as a PDF or a Word file, chosen by the output's extension.

Usage: python render.py <model.json> <output.pdf|output.docx>
"""
from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

FONT_PATH = Path(__file__).resolve().parents[2] / "packages/document-engine/src/assets/fonts/NanumGothic-Regular.ttf"
INK, MUTED, HEAD, STRIPE = "203154", "667085", "DDE7F5", "F3F6FA"


def draw_pdf(model: dict, output: str) -> None:
    from reportlab.lib.colors import HexColor, white
    from reportlab.lib.pagesizes import A4
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.pdfgen import canvas

    pdfmetrics.registerFont(TTFont("Nanum", str(FONT_PATH)))
    page = canvas.Canvas(output, pagesize=A4)
    _, height = A4
    left, width, bottom = 48.0, 500.0, 60.0
    y = height - 52

    def page_header() -> None:
        if model.get("header"):
            page.setFont("Nanum", 8)
            page.setFillColor(HexColor("#" + MUTED))
            page.drawString(left, height - 30, model["header"])
        page.setFillColor(HexColor("#" + INK))

    def new_page() -> float:
        page.showPage()
        page_header()
        return height - 52

    page_header()
    page.setFont("Nanum", 18)
    page.drawString(left, y, model["title"])
    y -= 34
    for block in model["blocks"]:
        kind = block["type"]
        if kind == "fields":
            page.setFont("Nanum", 10)
            x = left
            for name, value in block["items"]:
                text = f"{name}: {value}"
                page.drawString(x, y, text)
                x += pdfmetrics.stringWidth(text, "Nanum", 10) + 28
            y -= 24
        elif kind == "text":
            page.setFont("Nanum", 10)
            page.drawString(left, y, block["text"])
            y -= 24
        elif kind == "note":
            page.setFont("Nanum", 8)
            page.setFillColor(HexColor("#" + MUTED))
            page.drawString(left, max(y - 6, bottom - 20), block["text"])
            page.setFillColor(HexColor("#" + INK))
            y -= 24
        elif kind == "table":
            columns = block["columns"]
            row_height, column_width = 20.0, width / len(columns)

            def header_row(top: float) -> float:
                page.setFillColor(HexColor("#" + HEAD))
                page.rect(left, top - row_height, width, row_height, stroke=0, fill=1)
                page.setFillColor(HexColor("#" + INK))
                page.setFont("Nanum", 10)
                for index, name in enumerate(columns):
                    page.drawString(left + 8 + index * column_width, top - 14, name)
                return top - row_height

            y = header_row(y)
            for row_index, row in enumerate(block["rows"]):
                if y - row_height < bottom:
                    y = header_row(new_page())
                page.setFillColor(white if row_index % 2 == 0 else HexColor("#" + STRIPE))
                page.rect(left, y - row_height, width, row_height, stroke=0, fill=1)
                page.setFillColor(HexColor("#" + INK))
                page.setFont("Nanum", 10)
                for index, value in enumerate(row):
                    page.drawString(left + 8 + index * column_width, y - 14, value)
                y -= row_height
            y -= 16
    page.showPage()
    page.save()


NS = ('xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
      'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"')
FONT = '<w:rFonts w:ascii="Malgun Gothic" w:eastAsia="Malgun Gothic" w:hAnsi="Malgun Gothic"/>'


def run(text: str, *, bold: bool = False, size: int = 20, color: str = INK) -> str:
    props = FONT + ("<w:b/>" if bold else "") + f'<w:color w:val="{color}"/><w:sz w:val="{size}"/>'
    return f'<w:r><w:rPr>{props}</w:rPr><w:t xml:space="preserve">{escape(text)}</w:t></w:r>'


def paragraph(*runs: str, after: int = 120) -> str:
    return f'<w:p><w:pPr><w:spacing w:after="{after}"/></w:pPr>{"".join(runs)}</w:p>'


def word_table(columns: list[str], rows: list[list[str]]) -> str:
    width = 9000 // len(columns)
    borders = "".join(f'<w:{side} w:val="single" w:sz="4" w:color="B7C4D9"/>'
                      for side in ("top", "left", "bottom", "right", "insideH", "insideV"))

    def cell(text: str, *, header: bool = False, shade: str | None = None) -> str:
        fill = f'<w:shd w:val="clear" w:color="auto" w:fill="{shade}"/>' if shade else ""
        return (f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>{fill}</w:tcPr>'
                f'{paragraph(run(text, bold=header), after=0)}</w:tc>')

    head = '<w:tr><w:trPr><w:tblHeader/></w:trPr>' + "".join(cell(name, header=True, shade=HEAD) for name in columns) + "</w:tr>"
    body = "".join("<w:tr>" + "".join(cell(value, shade=None if index % 2 == 0 else STRIPE) for value in row) + "</w:tr>"
                   for index, row in enumerate(rows))
    grid = "".join(f'<w:gridCol w:w="{width}"/>' for _ in columns)
    return (f'<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders></w:tblPr>'
            f'<w:tblGrid>{grid}</w:tblGrid>{head}{body}</w:tbl>')


def draw_docx(model: dict, output: str) -> None:
    parts = [paragraph(run(model["title"], bold=True, size=36), after=240)]
    for block in model["blocks"]:
        kind = block["type"]
        if kind == "fields":
            runs = []
            for index, (name, value) in enumerate(block["items"]):
                runs += [run(("    " if index else "") + f"{name}: ", bold=True), run(value)]
            parts.append(paragraph(*runs))
        elif kind == "text":
            parts.append(paragraph(run(block["text"])))
        elif kind == "note":
            parts.append(paragraph(run(block["text"], size=16, color=MUTED), after=0))
        elif kind == "table":
            parts.append(word_table(block["columns"], block["rows"]))
            parts.append(paragraph(after=0))
    has_header = bool(model.get("header"))
    section = ('<w:sectPr>' + ('<w:headerReference w:type="default" r:id="rId1"/>' if has_header else "")
               + '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" '
               'w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>')
    document = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document {NS}><w:body>'
                f'{"".join(parts)}{section}</w:body></w:document>')
    overrides = '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    if has_header:
        overrides += '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>'
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            f'<Default Extension="xml" ContentType="application/xml"/>{overrides}</Types>'))
        archive.writestr("_rels/.rels", (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>'
            '</Relationships>'))
        archive.writestr("word/_rels/document.xml.rels", (
            '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
            '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            + ('<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>' if has_header else "")
            + '</Relationships>'))
        archive.writestr("word/document.xml", document)
        if has_header:
            archive.writestr("word/header1.xml", (
                f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr {NS}>'
                f'{paragraph(run(model["header"], size=16, color=MUTED), after=0)}</w:hdr>'))


if __name__ == "__main__":
    model = json.loads(Path(sys.argv[1]).read_text(encoding="utf-8"))
    (draw_docx if sys.argv[2].lower().endswith(".docx") else draw_pdf)(model, sys.argv[2])
