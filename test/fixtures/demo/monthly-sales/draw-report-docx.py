"""Draw one month's sales report as a Word file, from the JSON make-reports.mjs prints.

The same report as draw-report-pdf.py, written the way an office would keep it in Word: a header,
bold labels before their values, and a table with a row per category. Only the standard library is
used, so the file is plain WordprocessingML.

Usage: python draw-report-docx.py <report.json> <output.docx>
"""
from __future__ import annotations

import json
import sys
import zipfile
from pathlib import Path
from xml.sax.saxutils import escape

NS = (
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"'
)
CONTENT_TYPES = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>
</Types>"""
ROOT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>"""
DOCUMENT_RELS = """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
</Relationships>"""
FONT = '<w:rFonts w:ascii="Malgun Gothic" w:eastAsia="Malgun Gothic" w:hAnsi="Malgun Gothic"/>'


def won(value: int) -> str:
    return f"{value:,}원"


def run(text: str, *, bold: bool = False, size: int = 20, color: str = "203154") -> str:
    props = FONT + ("<w:b/>" if bold else "") + f'<w:color w:val="{color}"/><w:sz w:val="{size}"/>'
    return f'<w:r><w:rPr>{props}</w:rPr><w:t xml:space="preserve">{escape(text)}</w:t></w:r>'


def paragraph(*runs: str, after: int = 120) -> str:
    return f'<w:p><w:pPr><w:spacing w:after="{after}"/></w:pPr>{"".join(runs)}</w:p>'


def cell(text: str, *, width: int, header: bool = False, shade: str | None = None) -> str:
    fill = f'<w:shd w:val="clear" w:color="auto" w:fill="{shade}"/>' if shade else ""
    return (f'<w:tc><w:tcPr><w:tcW w:w="{width}" w:type="dxa"/>{fill}</w:tcPr>'
            f'{paragraph(run(text, bold=header), after=0)}</w:tc>')


def table(categories: list[dict]) -> str:
    widths = (3200, 2400, 3400)
    borders = "".join(f'<w:{side} w:val="single" w:sz="4" w:color="B7C4D9"/>'
                      for side in ("top", "left", "bottom", "right", "insideH", "insideV"))
    rows = ["<w:tr>" + "".join(cell(label, width=width, header=True, shade="DDE7F5")
                               for label, width in zip(("카테고리", "주문건수", "매출"), widths)) + "</w:tr>"]
    for index, row in enumerate(categories):
        shade = None if index % 2 == 0 else "F3F6FA"
        values = (row["카테고리"], f"{row['주문건수']}건", won(row["매출"]))
        rows.append("<w:tr>" + "".join(cell(value, width=width, shade=shade)
                                       for value, width in zip(values, widths)) + "</w:tr>")
    grid = "".join(f'<w:gridCol w:w="{width}"/>' for width in widths)
    return (f'<w:tbl><w:tblPr><w:tblW w:w="9000" w:type="dxa"/><w:tblBorders>{borders}</w:tblBorders></w:tblPr>'
            f'<w:tblGrid>{grid}</w:tblGrid>{"".join(rows)}</w:tbl>')


def main(source: str, output: str) -> None:
    data = json.loads(Path(source).read_text(encoding="utf-8"))
    summary = data["summary"][0]
    body = (
        paragraph(run("월간 매출 보고서", bold=True, size=36), after=240)
        + paragraph(run("기간: ", bold=True), run(summary["기간"]))
        + paragraph(run("주문건수: ", bold=True), run(f"{summary['주문건수']}건"),
                    run("    총매출: ", bold=True), run(won(summary["총매출"])),
                    run("    평균주문금액: ", bold=True), run(won(summary["평균주문금액"])), after=240)
        + table(data["categories"])
        + paragraph(run("취소 주문은 제외했습니다. 출처: 주문내역 엑셀", size=16, color="667085"), after=0)
    )
    section = ('<w:sectPr><w:headerReference w:type="default" r:id="rId1"/>'
               '<w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" '
               'w:left="1440" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr>')
    document = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:document {NS}><w:body>'
                f'{body}{section}</w:body></w:document>')
    header = (f'<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<w:hdr {NS}>'
              f'{paragraph(run("영업관리팀 · 사내 보고용", size=16, color="667085"), after=0)}</w:hdr>')
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("[Content_Types].xml", CONTENT_TYPES)
        archive.writestr("_rels/.rels", ROOT_RELS)
        archive.writestr("word/_rels/document.xml.rels", DOCUMENT_RELS)
        archive.writestr("word/document.xml", document)
        archive.writestr("word/header1.xml", header)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
