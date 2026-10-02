import json
import os
import sys
from pathlib import Path

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


payload = json.load(sys.stdin)
font_path = payload.get("fontPath")
font_name = "Helvetica"
if font_path and os.path.isfile(font_path):
    font_name = "AxBenchmarkFont"
    pdfmetrics.registerFont(TTFont(font_name, font_path))


def draw_text(document, x, y, value, size=9):
    document.setFont(font_name, size)
    document.setFillColor(colors.HexColor("#203154"))
    document.drawString(x, y, str(value))


def draw_table(document, row_count, values, row_offset):
    x = 40.0
    top = 700.0
    width = 515.0
    row_height = 19.0
    columns = ("\uACE0\uAC1D ID", "\uACE0\uAC1D", "\uC9C0\uC5ED", "\uB9E4\uCD9C", "\uC8FC\uBB38", "\uB2EC\uC131\uB960")
    widths = (62.0, 105.0, 66.0, 104.0, 55.0, 105.0)
    document.setFillColor(colors.HexColor("#DDE7F5"))
    document.rect(x, top - row_height, width, row_height, stroke=0, fill=1)
    offset = x
    for index, label in enumerate(columns):
        draw_text(document, offset + 5, top - 13, label, 8)
        offset += widths[index]
    for row_index in range(row_count):
        y = top - row_height * (row_index + 2)
        document.setFillColor(colors.white if row_index % 2 == 0 else colors.HexColor("#F3F6FA"))
        document.rect(x, y, width, row_height, stroke=0, fill=1)
        value_index = row_offset + row_index
        if value_index >= len(values):
            continue
        row = values[value_index]
        offset = x
        for column_index, key in enumerate(("id", "name", "region", "revenue", "orders", "attainment")):
            draw_text(document, offset + 5, y + 5, row[key], 8)
            offset += widths[column_index]


def write_pdf(path, values):
    document = canvas.Canvas(str(path), pagesize=A4)
    distribution = payload.get("pageRowDistribution") or [payload["templateRows"]]
    row_offset = 0
    for page_index, row_count in enumerate(distribution):
        if page_index == 0:
            draw_text(document, 40, 805, "\uC6D4\uAC04 \uACE0\uAC1D \uC2E4\uC801 \uBC0F \uC6B4\uC601 \uC694\uC57D", 14)
            draw_text(document, 400, 805, "AX REPORT E2E", 8)
            draw_text(document, 40, 780, "\uC2E4\uC801 \uAE30\uAC04", 9)
            draw_text(document, 160, 780, values.get("period", "") if values else "", 9)
            draw_text(document, 40, 755, "\uCD1D \uB9E4\uCD9C", 9)
            draw_text(document, 160, 755, values.get("revenue", "") if values else "", 9)
            draw_text(document, 300, 755, "\uCD1D \uC8FC\uBB38", 9)
            draw_text(document, 400, 755, values.get("orders", "") if values else "", 9)
            draw_text(document, 40, 730, "\uACE0\uAC1D \uC218", 9)
            draw_text(document, 160, 730, values.get("customers", "") if values else "", 9)
            draw_text(document, 300, 730, "\uD0C0\uAC9F \uB2EC\uC131\uB960", 9)
            draw_text(document, 400, 730, values.get("attainment", "") if values else "", 9)
        draw_table(document, row_count, (values or {}).get("rows", []), row_offset)
        draw_text(document, 40, 465, "\uCC98\uB9AC \uC0C1\uD0DC", 8)
        draw_text(document, 160, 465, (values or {}).get("status", ""), 8)
        draw_text(document, 40, 411, "SOURCE: orders-api + customer-db", 7)
        document.showPage()
        row_offset += row_count
    document.save()


root = Path(payload["root"])
root.mkdir(parents=True, exist_ok=True)
write_pdf(root / "template.pdf", None)
write_pdf(root / "example.pdf", payload["example"])
