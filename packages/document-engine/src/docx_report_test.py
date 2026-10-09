from __future__ import annotations

from pathlib import Path
import re
import tempfile
import unittest
import zipfile

from protocol import EngineRequest
from worker import handle_request
from write.docx_report import fill_docx_report, list_docx_spans, prepare_docx_report

_CONTENT_TYPES = (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
    '<Default Extension="xml" ContentType="application/xml"/>'
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
    '</Types>'
)
# w14 is declared but only named by mc:Ignorable: Word rejects the part if the declaration is lost.
_ROOT = (
    '<w:document xmlns:mc="http://schemas.openxmlformats.org/markup-compatibility/2006" '
    'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" '
    'xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml" mc:Ignorable="w14">'
)


def _p(*runs: str) -> str:
    return "<w:p>" + "".join(f'<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">{run}</w:t></w:r>' for run in runs) + "</w:p>"


def _row(*cells: str) -> str:
    return "<w:tr>" + "".join(f"<w:tc>{_p(cell)}</w:tc>" for cell in cells) + "</w:tr>"


def _write_report(path: Path) -> None:
    body = (
        _p("월간 매출 보고서 (", "2026", "-08)")
        + _p("총 주문 174건, 매출 10,474,000원")
        + "<w:tbl>" + _row("분류", "매출") + _row("전자기기", "5,740,100") + _row("식품", "2,738,900")
        + _row("합계", "8,479,000") + "</w:tbl>"
        + _p("작성: 영업팀")
    )
    xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + _ROOT + "<w:body>" + body + "</w:body></w:document>"
    with zipfile.ZipFile(path, "w") as archive:
        archive.writestr("[Content_Types].xml", _CONTENT_TYPES)
        archive.writestr("word/document.xml", xml)


def _text(path: Path) -> str:
    with zipfile.ZipFile(path) as archive:
        xml = archive.read("word/document.xml").decode("utf-8")
    return "".join(re.findall(r"<w:t[^>]*>([^<]*)</w:t>", xml))


def _removals(spans: dict, wanted: dict[str, list[str]]) -> list[dict]:
    removals = []
    for span in spans["spans"]:
        for needle, values in wanted.items():
            if needle in span["text"]:
                removals += [{"spanId": span["id"], "text": value} for value in values]
    return removals


class DocxReportTest(unittest.TestCase):
    def _prepared(self, directory: Path) -> tuple[Path, dict]:
        example = directory / "report.docx"
        _write_report(example)
        spans = list_docx_spans(example)
        removals = _removals(spans, {
            "월간 매출": ["2026-08"], "총 주문": ["174", "10,474,000"],
            "전자기기": ["전자기기"], "5,740,100": ["5,740,100"], "식품": ["식품"], "2,738,900": ["2,738,900"],
            "8,479,000": ["8,479,000"],
        })
        prepared = prepare_docx_report(example, removals, directory / "template.docx")
        return Path(prepared["templatePath"]), prepared["pair"]

    def test_paragraphs_are_listed_with_where_they_sit(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            example = Path(directory) / "report.docx"
            _write_report(example)
            spans = list_docx_spans(example)
            by_text = {span["text"]: span for span in spans["spans"]}
            self.assertIn("월간 매출 보고서 (2026-08)", by_text)
            self.assertEqual(by_text["식품"]["location"], "본문 표1 3행 1열")
            self.assertEqual(by_text["작성: 영업팀"]["location"], "본문 문단")
            self.assertEqual(spans["exampleImages"], [])

    def test_values_become_slots_and_repeating_rows_a_table_group(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            template, pair = self._prepared(Path(directory))
            self.assertEqual(pair["layout"], "flow")
            scalars = {slot["exampleText"] for slot in pair["scalarSlots"]}
            # The total row is shaped differently from the item rows, so it stays a single value.
            self.assertEqual(scalars, {"2026-08", "174", "10,474,000", "8,479,000"})
            self.assertEqual(len(pair["tableGroups"]), 1)
            group = pair["tableGroups"][0]
            self.assertEqual((group["rowCount"], group["columnCount"]), (2, 2))
            self.assertEqual([cell["exampleText"] for cell in group["rows"][1]["cells"]], ["식품", "2,738,900"])
            text = _text(template)
            self.assertIn("월간 매출 보고서 (", text)
            self.assertNotIn("2026", text)
            self.assertIn("분류", text)

    def test_a_value_split_across_runs_keeps_the_first_runs_formatting(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            template, pair = self._prepared(Path(directory))
            with zipfile.ZipFile(template) as archive:
                xml = archive.read("word/document.xml").decode("utf-8")
            period = next(slot["id"] for slot in pair["scalarSlots"] if slot["exampleText"] == "2026-08")
            self.assertRegex(xml, r"<w:b\s*/></w:rPr><w:t xml:space=\"preserve\">\{\{ax:" + period + r"\}\}</w:t>")
            self.assertIn('xmlns:w14="http://schemas.microsoft.com/office/word/2010/wordml"', xml)
            self.assertIn('mc:Ignorable="w14"', xml)

    def test_fill_grows_and_shrinks_the_repeating_rows(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            template, pair = self._prepared(root)
            group = pair["tableGroups"][0]
            groups = [{"id": group["id"], "rows": [[cell["id"] for cell in row["cells"]] for row in group["rows"]]}]
            values = {slot["id"]: {"2026-08": "2026-09", "174": "180", "10,474,000": "11,000,000",
                                   "8,479,000": "9,100,000"}[slot["exampleText"]] for slot in pair["scalarSlots"]}
            rows = [("전자기기", "5,000,000"), ("식품", "3,000,000"), ("문구", "1,100,000")]
            for index, (name, amount) in enumerate(rows):
                ids = groups[0]["rows"][index] if index < 2 else [f"overflow-{group['id']}-{index}-{c}" for c in range(2)]
                values[ids[0]], values[ids[1]] = name, amount
            result = fill_docx_report(template, groups, values, root / "grown.docx")
            self.assertTrue(result["verified"])
            text = _text(root / "grown.docx")
            self.assertIn("월간 매출 보고서 (2026-09)", text)
            self.assertIn("총 주문 180건, 매출 11,000,000원", text)
            self.assertLess(text.index("문구1,100,000"), text.index("합계9,100,000"))

            one_row = dict(values)
            for ids in groups[0]["rows"][1:]:
                one_row[ids[0]] = one_row[ids[1]] = ""
            for column in range(2):
                one_row.pop(f"overflow-{group['id']}-2-{column}")
            fill_docx_report(template, groups, one_row, root / "shrunk.docx")
            shrunk = _text(root / "shrunk.docx")
            self.assertIn("분류매출전자기기5,000,000합계9,100,000", shrunk)

    def test_a_value_not_in_its_paragraph_fails_closed(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            example = Path(directory) / "report.docx"
            _write_report(example)
            span = list_docx_spans(example)["spans"][0]
            with self.assertRaisesRegex(ValueError, "report_value_not_removed:1"):
                prepare_docx_report(example, [{"spanId": span["id"], "text": "없는 값"}], Path(directory) / "t.docx")

    def test_worker_runs_the_docx_commands_on_allowed_paths(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            example = Path(directory) / "report.docx"
            _write_report(example)
            response = handle_request(EngineRequest(id="1", command="docx_report_spans", params={
                "examplePath": str(example), "allowedPaths": [str(example)],
            }))
            self.assertTrue(response.ok, response.error)
            assert response.data is not None
            self.assertGreater(len(response.data["spans"]), 5)


if __name__ == "__main__":
    unittest.main()
