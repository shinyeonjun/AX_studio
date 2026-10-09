"""Draw one month's sales report as a PDF, from the JSON make-reports.mjs prints.

Usage: python draw-report-pdf.py <report.json> <output.pdf>
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

from reportlab.lib.colors import HexColor, white
from reportlab.lib.pagesizes import A4
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas

FONT = Path(__file__).resolve().parents[4] / "packages/document-engine/src/assets/fonts/NanumGothic-Regular.ttf"


def won(value: int) -> str:
    return f"{value:,}원"


def main(source: str, output: str) -> None:
    data = json.loads(Path(source).read_text(encoding="utf-8"))
    summary = data["summary"][0]
    pdfmetrics.registerFont(TTFont("Nanum", str(FONT)))
    page = canvas.Canvas(output, pagesize=A4)
    page.setFont("Nanum", 18)
    page.drawString(48, 790, "월간 매출 보고서")
    page.setFont("Nanum", 10)
    page.drawString(48, 765, f"기간: {summary['기간']}")
    page.drawString(48, 735, f"주문건수: {summary['주문건수']}건")
    page.drawString(220, 735, f"총매출: {won(summary['총매출'])}")
    page.drawString(400, 735, f"평균주문금액: {won(summary['평균주문금액'])}")

    x, top, width, row_height = 48.0, 700.0, 500.0, 22.0
    columns = ("카테고리", "주문건수", "매출")
    page.setFillColor(HexColor("#DDE7F5"))
    page.rect(x, top - row_height, width, row_height, stroke=0, fill=1)
    page.setFillColor(HexColor("#203154"))
    for index, label in enumerate(columns):
        page.drawString(x + 10 + index * (width / len(columns)), top - 15, label)
    for row_index, row in enumerate(data["categories"]):
        y = top - row_height * (row_index + 2)
        page.setFillColor(white if row_index % 2 == 0 else HexColor("#F3F6FA"))
        page.rect(x, y, width, row_height, stroke=0, fill=1)
        page.setFillColor(HexColor("#203154"))
        for index, value in enumerate((row["카테고리"], f"{row['주문건수']}건", won(row["매출"]))):
            page.drawString(x + 10 + index * (width / len(columns)), y + 7, value)
    page.setFont("Nanum", 8)
    page.drawString(48, 80, "취소 주문은 제외했습니다. 출처: 주문내역 엑셀")
    page.showPage()
    page.save()


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
