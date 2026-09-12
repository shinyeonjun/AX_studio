from __future__ import annotations

import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from pypdf import PdfReader, PdfWriter, PageObject
from pypdf.generic import (ArrayObject, DecodedStreamObject, DictionaryObject, NameObject,
                           RectangleObject, TextStringObject)
from reportlab.pdfgen import canvas

from pdf_form_test import _write_acroform_fixture, _write_native_widgets_fixture, _pdfium_text
from write.pdf_form import analyze_pdf_form, fill_pdf_form
from write.pdf_form_engine.widgets import FormWidget
from write.pdf_read import inspect_pages


def _appearance_text(widget) -> str:
    appearance = widget["/AP"]["/N"].get_object()
    page = PageObject()
    page[NameObject("/Contents")] = appearance
    page[NameObject("/Resources")] = appearance["/Resources"]
    return page.extract_text()


class PdfIntegrityTest(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source = self.root / "source.pdf"
        self.output = self.root / "filled.pdf"

    def fill(self, values):
        return fill_pdf_form(self.source, analyze_pdf_form(self.source, {"ocr": "off"}), values, self.output)

    def test_orphan_widget_root_is_repaired_and_remains_interactive(self):
        _write_acroform_fixture(self.source)
        writer = PdfWriter(clone_from=self.source)
        writer.root_object["/AcroForm"][NameObject("/Fields")] = ArrayObject()
        writer.write(self.source)
        writer.close()
        self.fill({"campaign_name": "Recovered"})
        reader = PdfReader(self.output)
        self.assertEqual(reader.get_fields()["campaign_name"]["/V"], "Recovered")
        self.assertEqual(len(reader.root_object["/AcroForm"]["/Fields"]), 1)
        self.assertIn("Recovered", _appearance_text(reader.pages[0]["/Annots"][0].get_object()))

    def test_duplicate_independent_field_roots_are_not_silently_merged(self):
        drawing = canvas.Canvas(str(self.source))
        for x in (60, 300):
            drawing.acroForm.textfield(name="same", x=x, y=700, width=150, height=24)
        drawing.showPage()
        drawing.save()
        with self.assertRaisesRegex(ValueError, "ambiguous_form_field"):
            self.fill({"same": "Value"})
        self.assertFalse(self.output.exists())

    def test_id_addressed_shared_text_value_updates_every_widget_appearance(self):
        _write_acroform_fixture(self.source)
        writer = PdfWriter(clone_from=self.source)
        original = writer.pages[0]["/Annots"][0].get_object()
        parent = DictionaryObject({NameObject("/T"): original.pop("/T"), NameObject("/FT"): NameObject("/Tx")})
        parent_ref = writer._add_object(parent)
        original[NameObject("/Parent")] = parent_ref
        second = DictionaryObject(original)
        second[NameObject("/Rect")] = RectangleObject((72, 650, 332, 674))
        second_ref = writer._add_object(second)
        parent[NameObject("/Kids")] = ArrayObject([original.indirect_reference, second_ref])
        writer.pages[0]["/Annots"].append(second_ref)
        writer.root_object["/AcroForm"][NameObject("/Fields")] = ArrayObject([parent_ref])
        writer.write(self.source)
        writer.close()
        template = analyze_pdf_form(self.source, {"ocr": "off"})
        fill_pdf_form(self.source, template, {template["fields"][0]["id"]: "Both"}, self.output)
        reader = PdfReader(self.output)
        self.assertEqual(reader.get_fields()["campaign_name"]["/V"], "Both")
        for widget in reader.pages[0]["/Annots"]:
            self.assertIn("Both", _appearance_text(widget.get_object()))

    def test_canonical_value_without_updated_appearance_is_rejected(self):
        _write_acroform_fixture(self.source)
        def broken_write(widget, writer, value, field, font_path):
            widget.canonical[NameObject("/V")] = TextStringObject(str(value))
        with patch.object(FormWidget, "write_value", broken_write):
            with self.assertRaisesRegex(ValueError, "output_text_render_verification_failed"):
                self.fill({"campaign_name": "Invisible"})
        self.assertFalse(self.output.exists())

    def test_saved_default_appearance_font_resolves_and_choice_uses_display_label(self):
        _write_native_widgets_fixture(self.source)
        writer = PdfWriter(clone_from=self.source)
        widget = writer.pages[0]["/Annots"][-1].get_object()
        widget[NameObject("/Opt")] = ArrayObject([
            ArrayObject([TextStringObject("dev"), TextStringObject("개발팀")]),
            ArrayObject([TextStringObject("sales"), TextStringObject("영업팀")]),
        ])
        writer.write(self.source)
        writer.close()
        self.fill({"department": "dev"})
        reader = PdfReader(self.output)
        widget = reader.pages[0]["/Annots"][-1].get_object()
        self.assertEqual(reader.get_fields()["department"]["/V"], "dev")
        self.assertIn("개발팀", _appearance_text(widget))
        font_name = str(widget["/DA"]).split()[0]
        self.assertIn(font_name, reader.root_object["/AcroForm"]["/DR"]["/Font"])

    def test_nested_vector_geometry_includes_each_parent_transform(self):
        drawing = canvas.Canvas(str(self.source))
        drawing.beginForm("inner")
        drawing.rect(10, 20, 80, 30)
        drawing.endForm()
        drawing.beginForm("outer")
        drawing.translate(30, 40)
        drawing.doForm("inner")
        drawing.endForm()
        drawing.translate(100, 200)
        drawing.scale(2, 2)
        drawing.doForm("outer")
        drawing.showPage()
        drawing.save()
        page = inspect_pages(self.source)[0]
        self.assertEqual(len(page.drawings), 1)
        rect = page.drawings[0]["rect"]
        self.assertAlmostEqual(rect[0], 180, delta=0.01)
        self.assertAlmostEqual(rect[2], 340, delta=0.01)
        self.assertAlmostEqual(rect[1], page.height - 380, delta=0.01)
        self.assertAlmostEqual(rect[3], page.height - 320, delta=0.01)

    def test_radio_group_spanning_pages_clears_the_previous_selection(self):
        _write_native_widgets_fixture(self.source)
        writer = PdfWriter(clone_from=self.source)
        first = writer.pages[0]
        second = writer.add_blank_page(float(first.mediabox.width), float(first.mediabox.height))
        low = first["/Annots"].pop(2)
        second[NameObject("/Annots")] = ArrayObject([low])
        high = first["/Annots"][1].get_object()
        high[NameObject("/AS")] = NameObject("/high")
        high["/Parent"][NameObject("/V")] = NameObject("/high")
        writer.write(self.source)
        writer.close()
        template = analyze_pdf_form(self.source, {"ocr": "off"})
        low_field = next(field for field in template["fields"] if field.get("exportValue") == "low")
        fill_pdf_form(self.source, template, {low_field["id"]: True}, self.output)
        reader = PdfReader(self.output)
        self.assertEqual(reader.get_fields()["level"]["/V"], "/low")
        self.assertEqual(reader.pages[0]["/Annots"][1].get_object()["/AS"], "/Off")
        self.assertEqual(reader.pages[1]["/Annots"][0].get_object()["/AS"], "/low")

    def test_null_radio_id_is_a_noop(self):
        _write_native_widgets_fixture(self.source)
        template = analyze_pdf_form(self.source, {"ocr": "off"})
        low = next(field for field in template["fields"] if field.get("exportValue") == "low")
        first = self.root / "selected.pdf"
        fill_pdf_form(self.source, template, {"level": "high"}, first)
        template = analyze_pdf_form(first, {"ocr": "off"})
        fill_pdf_form(first, template, {low["id"]: None}, self.output)
        self.assertEqual(PdfReader(self.output).get_fields()["level"]["/V"], "/high")

    def test_placeholder_suffix_spacing_background_and_other_occurrence_survive(self):
        drawing = canvas.Canvas(str(self.source))
        drawing.setFillColorRGB(0.8, 0.9, 1)
        drawing.rect(30, 680, 450, 80, stroke=1, fill=1)
        drawing.setFillColorRGB(0, 0, 0)
        drawing.drawString(50, 730, "Label: [[name]] suffix")
        drawing.drawString(50, 700, "Second: [[name]] end")
        drawing.showPage()
        drawing.save()
        template = analyze_pdf_form(self.source, {"ocr": "off"})
        fill_pdf_form(self.source, template, {template["fields"][0]["id"]: ""}, self.output)
        text = _pdfium_text(self.output)
        self.assertIn("Label:", text)
        self.assertIn("suffix", text)
        self.assertEqual(text.count("[[name]]"), 1)
        # Original suffix glyph coordinates must be unchanged, not shifted left.
        import pypdfium2 as pdfium
        positions = []
        pixels = []
        for path in (self.source, self.output):
            doc = pdfium.PdfDocument(str(path))
            try:
                page = doc[0]
                try:
                    textpage = page.get_textpage()
                    try:
                        search = textpage.search("suffix")
                        start, count = search.get_next()
                        positions.append([textpage.get_charbox(i) for i in range(start, start + count)])
                        search.close()
                    finally:
                        textpage.close()
                    bitmap = page.render(scale=1)
                    try:
                        pixels.append(bitmap.to_pil().getpixel((35, round(page.get_height() - 685))))
                    finally:
                        bitmap.close()
                finally:
                    page.close()
            finally:
                doc.close()
        # PDFium uses float32 geometry; TJ regrouping can differ by ~0.00002pt.
        for before, after in zip(positions[0], positions[1]):
            for original, saved in zip(before, after):
                self.assertAlmostEqual(original, saved, delta=0.001)
        self.assertEqual(pixels[0], pixels[1])

    def test_placeholder_split_across_text_show_operations(self):
        drawing = canvas.Canvas(str(self.source))
        text = drawing.beginText(72, 720)
        text.textOut("Before [[cam")
        text.textOut("paign]] after")
        drawing.drawText(text)
        drawing.showPage()
        drawing.save()
        self.fill({"campaign": "Launch"})
        output = _pdfium_text(self.output)
        self.assertNotIn("[[", output)
        self.assertIn("Before", output)
        self.assertIn("after", output)
        self.assertIn("Launch", output)

    def test_shared_form_xobject_changes_only_the_selected_placement(self):
        drawing = canvas.Canvas(str(self.source))
        drawing.beginForm("repeated")
        drawing.drawString(0, 0, "[[name]] suffix")
        drawing.endForm()
        for y in (700, 650):
            drawing.saveState()
            drawing.translate(72, y)
            drawing.doForm("repeated")
            drawing.restoreState()
        drawing.showPage()
        drawing.save()
        template = analyze_pdf_form(self.source, {"ocr": "off"})
        self.assertEqual(len(template["fields"]), 2)
        fill_pdf_form(self.source, template, {template["fields"][0]["id"]: "One"}, self.output)
        text = _pdfium_text(self.output)
        self.assertEqual(text.count("[[name]]"), 1)
        self.assertEqual(text.count("suffix"), 2)
        self.assertIn("One", text)


if __name__ == "__main__":
    unittest.main()
