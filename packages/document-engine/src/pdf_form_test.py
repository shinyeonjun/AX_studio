from __future__ import annotations

import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import pymupdf
from PIL import Image, ImageDraw
from pypdf import PdfReader, PdfWriter
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from protocol import EngineRequest
from worker import handle_request
from write.pdf_form import (
    PdfPageGeometry,
    _ocr_candidate_fields,
    _ocr_geometry_fields,
    _find_font_path,
    _placeholder_fields_from_text,
    analyze_pdf_form,
    fill_pdf_form,
    persist_pdf_form_template,
)


def _sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _write_digital_fixture(path: Path) -> None:
    document = canvas.Canvas(str(path), pagesize=A4)
    document.setFont("Helvetica", 12)
    document.drawString(72, 770, "Campaign: [[campaign_name]]")
    document.drawString(72, 730, "Owner: [[owner_name]]")
    document.line(72, 710, 400, 710)
    document.showPage()
    document.save()


def _write_geometry_fixture(path: Path) -> None:
    document = canvas.Canvas(str(path), pagesize=A4)
    document.setFont("Helvetica", 12)
    document.drawString(72, 770, "Campaign name")
    document.line(72, 730, 400, 730)
    document.rect(72, 640, 328, 48)
    document.showPage()
    document.save()


def _write_acroform_fixture(path: Path) -> None:
    document = canvas.Canvas(str(path), pagesize=A4)
    document.setFont("Helvetica", 12)
    document.drawString(72, 770, "Campaign")
    document.acroForm.textfield(
        name="campaign_name",
        tooltip="Campaign name",
        x=72,
        y=730,
        width=260,
        height=24,
        borderWidth=1,
        forceBorder=True,
    )
    document.showPage()
    document.save()


def _write_native_widgets_fixture(path: Path) -> None:
    document = canvas.Canvas(str(path), pagesize=A4)
    document.setFont("Helvetica", 11)
    document.drawString(72, 790, "Agreement")
    document.acroForm.checkbox(
        name="agree",
        tooltip="Agree",
        x=72,
        y=740,
        size=20,
        checked=False,
        forceBorder=True,
    )
    document.drawString(110, 746, "Agree")
    document.acroForm.radio(
        name="level",
        value="high",
        tooltip="Level high",
        x=72,
        y=690,
        selected=False,
        forceBorder=True,
    )
    document.acroForm.radio(
        name="level",
        value="low",
        tooltip="Level low",
        x=112,
        y=690,
        selected=False,
        forceBorder=True,
    )
    document.drawString(150, 696, "Level")
    document.acroForm.choice(
        name="department",
        tooltip="Department",
        value="Sales",
        options=["Sales", "Engineering"],
        x=72,
        y=630,
        width=180,
        height=26,
        forceBorder=True,
    )
    document.drawString(270, 638, "Department")
    document.showPage()
    document.save()


def _write_multi_page_fixture(path: Path) -> None:
    document = canvas.Canvas(str(path), pagesize=A4)
    document.setFont("Helvetica", 12)
    for label in ("Page one source", "Page two rotated source", "Page three rotated source", "Page four rotated source"):
        document.drawString(72, 780, label)
        document.showPage()
    document.save()

    reader = PdfReader(str(path))
    writer = PdfWriter()
    for index, page in enumerate(reader.pages):
        rotation = (0, 90, 180, 270)[index]
        if rotation:
            page.rotate(rotation)
        writer.add_page(page)
    with path.open("wb") as stream:
        writer.write(stream)


class PdfFormPipelineTest(unittest.TestCase):
    def test_placeholder_geometry_is_derived_from_text_boxes(self) -> None:
        page = PdfPageGeometry(index=0, width=595.0, height=842.0, rotation=0)
        fields = _placeholder_fields_from_text(
            "Campaign: [[campaign_name]]",
            [
                (72.0, 760.0, 80.0, 772.0),
                (82.0, 760.0, 90.0, 772.0),
                (92.0, 760.0, 100.0, 772.0),
                (102.0, 760.0, 110.0, 772.0),
                (112.0, 760.0, 120.0, 772.0),
                (122.0, 760.0, 130.0, 772.0),
                (130.0, 760.0, 138.0, 772.0),
                (138.0, 760.0, 146.0, 772.0),
                (146.0, 760.0, 154.0, 772.0),
                (154.0, 760.0, 162.0, 772.0),
                (162.0, 760.0, 170.0, 772.0),
                (170.0, 760.0, 178.0, 772.0),
                (178.0, 760.0, 186.0, 772.0),
                (186.0, 760.0, 194.0, 772.0),
                (194.0, 760.0, 202.0, 772.0),
                (202.0, 760.0, 210.0, 772.0),
                (210.0, 760.0, 218.0, 772.0),
                (218.0, 760.0, 226.0, 772.0),
                (226.0, 760.0, 234.0, 772.0),
                (234.0, 760.0, 242.0, 772.0),
                (242.0, 760.0, 250.0, 772.0),
                (250.0, 760.0, 258.0, 772.0),
                (258.0, 760.0, 266.0, 772.0),
                (266.0, 760.0, 274.0, 772.0),
                (274.0, 760.0, 282.0, 772.0),
                (282.0, 760.0, 290.0, 772.0),
                (290.0, 760.0, 298.0, 772.0),
            ],
            page,
            source="digital_placeholder",
            confidence=0.98,
        )
        self.assertEqual(len(fields), 1)
        self.assertEqual(fields[0]["name"], "campaign_name")
        self.assertAlmostEqual(fields[0]["rect"]["y"], 70.0)
        self.assertEqual(fields[0]["source"], "digital_placeholder")

    def test_ocr_label_candidate_uses_detected_position(self) -> None:
        page = PdfPageGeometry(index=0, width=595.0, height=842.0, rotation=0)
        fields = _ocr_candidate_fields(
            page,
            [("Department", (100.0, 200.0, 180.0, 224.0), 0.95)],
            scale=2.0,
        )
        self.assertEqual(len(fields), 1)
        self.assertEqual(fields[0]["name"], "Department")
        self.assertEqual(fields[0]["source"], "ocr_label")
        self.assertAlmostEqual(fields[0]["rect"]["x"], 98.0)
        self.assertAlmostEqual(fields[0]["rect"]["y"], 98.0)
        self.assertLess(fields[0]["confidence"], 0.9)

    def test_ocr_geometry_candidate_uses_detected_ruled_regions(self) -> None:
        page = PdfPageGeometry(index=0, width=600.0, height=500.0, rotation=0)
        image = Image.new("L", (600, 500), 255)
        draw = ImageDraw.Draw(image)
        for y in (50, 150, 300, 450):
            draw.line((40, y, 560, y), fill=80, width=2)
        fields = _ocr_geometry_fields(page, image, [], scale=1.0)
        self.assertEqual(len(fields), 3)
        self.assertTrue(all(field["source"] == "ocr_geometry" for field in fields))
        self.assertTrue(any(field["multiline"] for field in fields))
        self.assertGreater(fields[-1]["rect"]["height"], fields[0]["rect"]["height"])

    def test_digital_pdf_is_analyzed_and_filled_without_changing_source(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "digital.pdf"
            output = root / "digital-filled.pdf"
            _write_digital_fixture(source)
            before = _sha256(source)
            template = analyze_pdf_form(source, {"ocr": "off"})
            self.assertEqual(template["mode"], "digital")
            self.assertEqual([field["name"] for field in template["fields"]], ["campaign_name", "owner_name"])
            result = fill_pdf_form(source, template, {template["fields"][0]["id"]: "Launch"}, output)
            self.assertEqual(_sha256(source), before)
            self.assertTrue(output.is_file())
            self.assertEqual(result["writerEngine"], "pymupdf")
            self.assertTrue(result["verified"])
            output_text = PdfReader(str(output)).pages[0].extract_text() or ""
            self.assertIn("Launch", output_text)
            self.assertNotIn("[[campaign_name]]", output_text)

    def test_digital_geometry_uses_vector_regions_when_no_placeholders_exist(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "geometry.pdf"
            _write_geometry_fixture(source)
            template = analyze_pdf_form(source, {"ocr": "off"})
            self.assertEqual(template["mode"], "digital")
            self.assertTrue(template["fields"])
            self.assertTrue(all(field["source"] == "digital_geometry" for field in template["fields"]))
            self.assertTrue(any(field["multiline"] for field in template["fields"]))

    def test_acroform_is_filled_interactively_and_source_is_untouched(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "acroform.pdf"
            output = root / "acroform-filled.pdf"
            _write_acroform_fixture(source)
            before = _sha256(source)
            template = analyze_pdf_form(source, {"ocr": "off"})
            self.assertEqual(template["mode"], "acroform")
            self.assertEqual(template["fields"][0]["name"], "campaign_name")
            result = fill_pdf_form(source, template, {template["fields"][0]["id"]: "Launch"}, output)
            self.assertEqual(result["writerEngine"], "pymupdf")
            self.assertTrue(result["verified"])
            self.assertTrue(result["interactive"])
            self.assertTrue(result["sourceUnchanged"])
            self.assertEqual(_sha256(source), before)
            fields = PdfReader(str(output)).get_fields() or {}
            self.assertEqual(str(fields["campaign_name"].get("/V")), "Launch")

    def test_native_unicode_text_is_verified_against_rendered_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "acroform.pdf"
            output = root / "acroform-korean-filled.pdf"
            _write_acroform_fixture(source)
            template = analyze_pdf_form(source, {"ocr": "off"})
            value = "한글 입력 AX"
            result = fill_pdf_form(source, template, {template["fields"][0]["id"]: value}, output)
            self.assertTrue(result["verified"])

            document = pymupdf.open(str(output))
            try:
                widget = list(document[0].widgets() or [])[0]
                rendered = document[0].get_text("text", clip=widget.rect) or ""
                self.assertIn(value, rendered)
            finally:
                document.close()

    def test_native_unsupported_glyph_is_not_published_as_success(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "acroform.pdf"
            output = root / "acroform-unsupported-glyph.pdf"
            _write_acroform_fixture(source)
            template = analyze_pdf_form(source, {"ocr": "off"})
            with self.assertRaisesRegex(ValueError, "output_text_render_verification_failed"):
                fill_pdf_form(
                    source,
                    template,
                    {template["fields"][0]["id"]: "한글 🙂"},
                    output,
                )
            self.assertFalse(output.exists())

    def test_unicode_overlay_requires_an_existing_font_and_glyph_coverage(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "digital.pdf"
            output = root / "digital-korean-filled.pdf"
            _write_digital_fixture(source)
            template = analyze_pdf_form(source, {"ocr": "off"})
            field_id = template["fields"][0]["id"]

            with self.assertRaisesRegex(ValueError, "font_not_found"):
                fill_pdf_form(
                    source,
                    template,
                    {field_id: "한글 입력 AX"},
                    output,
                    font_path=str(root / "missing-font.ttf"),
                )
            self.assertFalse(output.exists())

            segoe = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts" / "segoeui.ttf"
            if segoe.is_file():
                with self.assertRaisesRegex(ValueError, "font_glyph_missing"):
                    fill_pdf_form(
                        source,
                        template,
                        {field_id: "한글 입력 AX"},
                        output,
                        font_path=str(segoe),
                    )
                self.assertFalse(output.exists())

    def test_unicode_overlay_round_trips_with_a_validated_font(self) -> None:
        font_path = _find_font_path()
        if font_path is None:
            self.skipTest("no test font available")
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "digital.pdf"
            output = root / "digital-korean-filled.pdf"
            _write_digital_fixture(source)
            template = analyze_pdf_form(source, {"ocr": "off"})
            value = "한글 입력 AX"
            result = fill_pdf_form(
                source,
                template,
                {template["fields"][0]["id"]: value},
                output,
                font_path=str(font_path),
            )
            self.assertTrue(result["verified"])
            document = pymupdf.open(str(output))
            try:
                self.assertIn(value, document[0].get_text("text"))
            finally:
                document.close()

    def test_unicode_overlay_uses_embedded_fallback_without_a_system_font(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "digital.pdf"
            output = root / "digital-korean-fallback-filled.pdf"
            _write_digital_fixture(source)
            template = analyze_pdf_form(source, {"ocr": "off"})
            value = "한글 입력 AX"
            with patch.dict(os.environ, {"WINDIR": str(root / "no-windows-fonts")}):
                result = fill_pdf_form(
                    source,
                    template,
                    {template["fields"][0]["id"]: value},
                    output,
                )
            self.assertTrue(result["verified"])
            document = pymupdf.open(str(output))
            try:
                self.assertIn(value, document[0].get_text("text"))
                self.assertTrue(
                    any(font[3] == "Droid Sans Fallback Regular" for font in document[0].get_fonts(full=True))
                )
            finally:
                document.close()

    def test_native_checkbox_radio_and_choice_are_filled_and_verified(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "native-widgets.pdf"
            output = root / "native-widgets-filled.pdf"
            _write_native_widgets_fixture(source)
            template = analyze_pdf_form(source, {"ocr": "off"})
            self.assertEqual(template["mode"], "acroform")
            self.assertEqual(
                {field["type"] for field in template["fields"]},
                {"checkbox", "radio", "select"},
            )
            radio_fields = [field for field in template["fields"] if field["type"] == "radio"]
            self.assertEqual({field.get("exportValue") for field in radio_fields}, {"high", "low"})
            checkbox = next(field for field in template["fields"] if field["type"] == "checkbox")
            low = next(field for field in radio_fields if field.get("exportValue") == "low")
            choice = next(field for field in template["fields"] if field["type"] == "select")
            self.assertEqual(choice.get("options"), ["Sales", "Engineering"])
            result = fill_pdf_form(
                source,
                template,
                {checkbox["id"]: True, low["id"]: True, choice["id"]: "Engineering"},
                output,
            )
            self.assertEqual(result["writerEngine"], "pymupdf")
            self.assertTrue(result["verified"])
            fields = PdfReader(str(output)).get_fields() or {}
            self.assertEqual(str(fields["agree"].get("/V")).lstrip("/"), "Yes")
            self.assertEqual(str(fields["level"].get("/V")).lstrip("/"), "low")
            self.assertEqual(str(fields["department"].get("/V")).lstrip("/"), "Engineering")

            name_output = root / "native-widgets-name-filled.pdf"
            name_result = fill_pdf_form(
                source,
                template,
                {"agree": False, "level": "high", "department": "Sales"},
                name_output,
            )
            self.assertTrue(name_result["verified"])
            name_fields = PdfReader(str(name_output)).get_fields() or {}
            self.assertEqual(str(name_fields["agree"].get("/V")).lstrip("/"), "Off")
            self.assertEqual(str(name_fields["level"].get("/V")).lstrip("/"), "high")
            self.assertEqual(str(name_fields["department"].get("/V")).lstrip("/"), "Sales")

            invalid_output = root / "native-widgets-invalid.pdf"
            with self.assertRaisesRegex(ValueError, "field_option_invalid"):
                fill_pdf_form(source, template, {choice["id"]: "Finance"}, invalid_output)
            self.assertFalse(invalid_output.exists())

    def test_overlay_preserves_multi_page_rotated_geometry_and_verifies_values(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "multi-page-rotated.pdf"
            output = root / "multi-page-rotated-filled.pdf"
            _write_multi_page_fixture(source)
            template = analyze_pdf_form(
                source,
                {
                    "ocr": "off",
                    "fieldHints": [
                        {"id": "page-one", "name": "page_one", "pageIndex": 0, "rect": {"x": 72, "y": 100, "width": 220, "height": 26}},
                        {"id": "page-one-check", "name": "page_one_check", "pageIndex": 0, "rect": {"x": 320, "y": 100, "width": 20, "height": 20}, "type": "checkbox"},
                        {"id": "page-one-radio", "name": "page_one_radio", "pageIndex": 0, "rect": {"x": 360, "y": 100, "width": 20, "height": 20}, "type": "radio"},
                        {"id": "page-two", "name": "page_two", "pageIndex": 1, "rect": {"x": 72, "y": 100, "width": 220, "height": 26}},
                        {"id": "page-two-check", "name": "page_two_check", "pageIndex": 1, "rect": {"x": 320, "y": 150, "width": 20, "height": 20}, "type": "checkbox"},
                        {"id": "page-three", "name": "page_three", "pageIndex": 2, "rect": {"x": 72, "y": 100, "width": 220, "height": 26}},
                        {"id": "page-three-check", "name": "page_three_check", "pageIndex": 2, "rect": {"x": 320, "y": 150, "width": 20, "height": 20}, "type": "checkbox"},
                        {"id": "page-four", "name": "page_four", "pageIndex": 3, "rect": {"x": 72, "y": 100, "width": 220, "height": 26}},
                        {"id": "page-four-check", "name": "page_four_check", "pageIndex": 3, "rect": {"x": 320, "y": 150, "width": 20, "height": 20}, "type": "checkbox"},
                    ],
                },
            )
            source_reader = PdfReader(str(source))
            result = fill_pdf_form(
                source,
                template,
                {"page-one": "First page", "page-one-check": True, "page-one-radio": True, "page-two": "Second page", "page-two-check": True, "page-three": "Third page", "page-three-check": True, "page-four": "Fourth page", "page-four-check": True},
                output,
            )
            self.assertTrue(result["verified"])
            self.assertEqual(result["pageCount"], 4)
            output_reader = PdfReader(str(output))
            self.assertEqual(len(output_reader.pages), len(source_reader.pages))
            for source_page, output_page in zip(source_reader.pages, output_reader.pages):
                self.assertEqual(int(output_page.rotation), int(source_page.rotation))
                self.assertAlmostEqual(float(output_page.mediabox.width), float(source_page.mediabox.width))
                self.assertAlmostEqual(float(output_page.mediabox.height), float(source_page.mediabox.height))
            output_text = "\n".join((page.extract_text() or "") for page in output_reader.pages)
            self.assertIn("First page", output_text)
            self.assertIn("Second page", output_text)
            self.assertIn("Third page", output_text)
            self.assertIn("Fourth page", output_text)

    def test_overlay_text_overflow_fails_without_publishing_partial_output(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "overflow.pdf"
            output = root / "overflow-filled.pdf"
            _write_digital_fixture(source)
            template = analyze_pdf_form(
                source,
                {
                    "ocr": "off",
                    "fieldHints": [
                        {"id": "tiny", "name": "tiny", "pageIndex": 0, "rect": {"x": 72, "y": 100, "width": 22, "height": 6}},
                    ],
                },
            )
            with self.assertRaisesRegex(ValueError, "field_text_overflow"):
                fill_pdf_form(source, template, {"tiny": "This value cannot fit"}, output)
            self.assertFalse(output.exists())

    def test_template_schema_hash_and_page_count_are_required_for_fill(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "digital.pdf"
            output = root / "filled.pdf"
            _write_digital_fixture(source)
            template = analyze_pdf_form(source, {"ocr": "off"})
            field_id = template["fields"][0]["id"]
            with self.assertRaisesRegex(ValueError, "template_schema_invalid"):
                fill_pdf_form(source, {**template, "schemaVersion": 999}, {field_id: "x"}, output)
            with self.assertRaisesRegex(ValueError, "template_source_mismatch"):
                fill_pdf_form(source, {**template, "sourceHash": "not-the-source"}, {field_id: "x"}, output)
            with self.assertRaisesRegex(ValueError, "template_page_count_mismatch"):
                fill_pdf_form(source, {**template, "pageCount": 2}, {field_id: "x"}, output)
            with self.assertRaisesRegex(ValueError, "template_coordinate_space_invalid"):
                fill_pdf_form(source, {**template, "coordinateSpace": "pdf-user-bottom-left"}, {field_id: "x"}, output)
            with self.assertRaisesRegex(ValueError, "template_page_geometry_mismatch"):
                fill_pdf_form(
                    source,
                    {**template, "pages": [{**template["pages"][0], "rotation": 90}]},
                    {field_id: "x"},
                    output,
                )
            with self.assertRaisesRegex(ValueError, "template_field_rect_invalid"):
                fill_pdf_form(
                    source,
                    {**template, "fields": [{**template["fields"][0], "rect": {"x": 0, "y": 0, "width": -1, "height": 10}}]},
                    {field_id: "x"},
                    output,
                )
            with self.assertRaisesRegex(ValueError, "source_overwrite_forbidden"):
                fill_pdf_form(source, template, {field_id: "x"}, source)
            self.assertFalse(output.exists())

    def test_native_field_application_failure_is_not_reported_as_success(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "acroform.pdf"
            output = root / "acroform-filled.pdf"
            _write_acroform_fixture(source)
            template = analyze_pdf_form(source, {"ocr": "off"})
            broken_template = {
                **template,
                "fields": [{**template["fields"][0], "name": "missing_field"}],
            }
            with self.assertRaisesRegex(ValueError, "native_fields_not_applied"):
                fill_pdf_form(
                    source,
                    broken_template,
                    {template["fields"][0]["id"]: "Launch"},
                    output,
                )
            self.assertFalse(output.exists())

    def test_worker_persists_template_and_fills_using_template_path(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "digital.pdf"
            output = root / "worker-filled.pdf"
            _write_digital_fixture(source)
            analyzed = handle_request(
                EngineRequest(
                    id="analyze-1",
                    command="pdf_form_analyze",
                    params={"path": str(source), "templateRoot": str(root / "templates"), "options": {"ocr": "off"}},
                )
            )
            self.assertTrue(analyzed.ok)
            self.assertIsNotNone(analyzed.data)
            assert analyzed.data is not None
            field_id = analyzed.data["fields"][0]["id"]
            template_path = analyzed.data["templatePath"]
            filled = handle_request(
                EngineRequest(
                    id="fill-1",
                    command="pdf_form_fill",
                    params={
                        "path": str(source),
                        "templatePath": template_path,
                        "values": {field_id: "Worker value"},
                        "outputPath": str(output),
                    },
                )
            )
            self.assertTrue(filled.ok)
            self.assertEqual(filled.data["outputPath"], str(output.resolve()))
            self.assertTrue(output.is_file())

    def test_persisted_template_keeps_source_copy_and_review_signal(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / "digital.pdf"
            _write_digital_fixture(source)
            template = persist_pdf_form_template(source, root / "templates", {"ocr": "off"})
            self.assertTrue(Path(template["templatePath"]).is_file())
            self.assertTrue(Path(template["originalPdfPath"]).is_file())
            self.assertEqual(_sha256(Path(template["originalPdfPath"])), _sha256(source))
            self.assertFalse(template["requiresReview"])


if __name__ == "__main__":
    unittest.main()
