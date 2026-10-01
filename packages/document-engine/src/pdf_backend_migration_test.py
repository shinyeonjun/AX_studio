from __future__ import annotations

import hashlib
from pathlib import Path
import tempfile
import unittest
from unittest.mock import MagicMock, call, patch

from pypdf import PdfReader, PdfWriter
from pypdf.generic import DecodedStreamObject, NameObject, TextStringObject
from reportlab.pdfgen import canvas
from reportlab.pdfbase import pdfmetrics

from pdf_form_test import _write_acroform_fixture, _write_native_widgets_fixture
from write.pdf_form import analyze_pdf_form, fill_pdf_form
from write.pdf_form_engine.widgets import FormWidget, appearance_pdf
from write.pdf_form_engine.fonts import _BUNDLED_CJK_FONT, _find_font_path
from write.pdf_form_engine.overlay import _draw_checkbox
from write.pdf_read import open_pdf, page_text, render_page


def _blank_source(path: Path, rotation: int = 0) -> None:
    document = canvas.Canvas(str(path), pagesize=(200, 200))
    document.showPage()
    document.save()
    if rotation:
        writer = PdfWriter(clone_from=path)
        writer.pages[0].rotate(rotation)
        writer.write(path)
        writer.close()


def _template(source: Path, fields: list[dict]) -> dict:
    page = PdfReader(source).pages[0]
    return {
        'schemaVersion': 1, 'coordinateSpace': 'pdf-user-top-left-unrotated',
        'sourceHash': hashlib.sha256(source.read_bytes()).hexdigest(),
        'pageCount': 1, 'mode': 'digital',
        'pages': [{'index': 0, 'width': float(page.mediabox.width),
                   'height': float(page.mediabox.height), 'rotation': page.rotation}],
        'fields': fields,
    }


def _field(name: str, rect: tuple[float, float, float, float], **options) -> dict:
    x, y, width, height = rect
    return {'id': name, 'name': name, 'pageIndex': 0, 'source': 'user_hint',
            'type': 'text', 'rect': {'x': x, 'y': y, 'width': width, 'height': height},
            **options}


class PdfBackendMigrationTest(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.root = Path(self.directory.name)
        self.source = self.root / 'source.pdf'
        self.output = self.root / 'filled.pdf'

    def test_bottom_edge_padding_cannot_publish_clipped_descenders(self) -> None:
        _blank_source(self.source)
        # At 5pt Helvetica needs 4.625pt of ascent/descent. This rectangle has
        # no room for bottom padding, so accepting its nominal +1pt clips it.
        template = _template(self.source, [_field('edge', (2, 196.3, 80, 3.7), fontSize=5)])
        before = self.source.read_bytes()
        with self.assertRaisesRegex(ValueError, 'field_text_overflow'):
            fill_pdf_form(self.source, template, {'edge': 'gyp'}, self.output)
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.root.glob('.filled-*.tmp')), [])
        self.assertEqual(self.source.read_bytes(), before)

    def test_overlay_checkbox_is_a_tick_inside_its_rectangle(self) -> None:
        drawing = MagicMock()
        _draw_checkbox(drawing, (0, 0, 20, 20), True, 'checkbox', 100)
        self.assertEqual(drawing.line.call_args_list, [call(3, 89, 8, 83), call(8, 83, 17, 97)])

    def test_all_rotations_round_trip_cjk_at_page_edges_and_render_marks(self) -> None:
        for rotation in (0, 90, 180, 270):
            with self.subTest(rotation=rotation):
                _blank_source(self.source, rotation)
                fields = [_field('top', (2, 0, 196, 18), fontSize=8.3),
                          _field('bottom', (2, 182, 196, 18), fontSize=8.3),
                          _field('right', (130, 75, 70, 18), fontSize=8.3, align='right'),
                          _field('check', (2, 75, 14, 14), type='checkbox'),
                          _field('radio', (20, 75, 14, 14), type='radio')]
                mixed = '한글 中文測試 日本語テスト éü'
                values = {'top': mixed, 'bottom': '한글 하단 gy',
                          'right': '우측 AX', 'check': True, 'radio': True}
                result = fill_pdf_form(self.source, _template(self.source, fields), values, self.output)
                self.assertTrue(result['verified'])
                self.assertEqual(PdfReader(self.output).pages[0].rotation, rotation)
                with open_pdf(self.output) as document:
                    page = document[0]
                    try:
                        text = page_text(page)
                        for value in (mixed, '한글 하단 gy', '우측 AX'):
                            self.assertIn(value, text)
                        textpage = page.get_textpage()
                        try:
                            for index in range(textpage.count_chars()):
                                left, bottom, right, top = textpage.get_charbox(index)
                                self.assertGreaterEqual(left, -0.05)
                                self.assertGreaterEqual(bottom, -0.05)
                                self.assertLessEqual(right, 200.05)
                                self.assertLessEqual(top, 200.05)
                        finally:
                            textpage.close()
                        pixels = render_page(page)
                        try:
                            extrema = pixels.convert('L').getextrema()
                            self.assertLess(extrema[0], extrema[1])
                        finally:
                            pixels.close()
                    finally:
                        page.close()

    def test_bundled_pan_cjk_native_text_preserves_value_and_saved_rendering(self) -> None:
        _write_acroform_fixture(self.source)
        value = '한글 中文測試 日本語テスト éü'
        self.assertEqual(_find_font_path(text=value), _BUNDLED_CJK_FONT)
        template = analyze_pdf_form(self.source, {'ocr': 'off'})
        result = fill_pdf_form(self.source, template, {'campaign_name': value}, self.output)
        self.assertTrue(result['interactive'])
        reader = PdfReader(self.output)
        self.assertEqual(reader.get_fields()['campaign_name']['/V'], value)
        raw = reader.pages[0]['/Annots'][0].get_object()
        with open_pdf(appearance_pdf(FormWidget(raw, float(reader.pages[0].mediabox.height)))) as document:
            page = document[0]
            try:
                self.assertIn(value, page_text(page))
                image = render_page(page)
                try:
                    self.assertLess(image.convert('L').getextrema()[0], 255)
                finally:
                    image.close()
            finally:
                page.close()

    def test_fractional_size_retries_the_exact_five_point_minimum(self) -> None:
        _blank_source(self.source)
        text = 'minimum'
        width = pdfmetrics.stringWidth(text, 'Helvetica', 5)
        template = _template(self.source, [_field('fractional', (10, 10, width, 8.3), fontSize=5.3)])
        fill_pdf_form(self.source, template, {'fractional': text}, self.output)
        content = PdfReader(self.output).pages[0].get_contents()
        sizes = [float(values[1]) for values, operator in content.operations if operator == b'Tf']
        self.assertEqual(sizes[-1], 5.0)

    def test_blank_native_value_rejects_a_stale_saved_appearance(self) -> None:
        _write_acroform_fixture(self.source)
        first = self.root / 'first.pdf'
        fill_pdf_form(self.source, analyze_pdf_form(self.source, {'ocr': 'off'}),
                      {'campaign_name': 'Previous'}, first)
        template = analyze_pdf_form(first, {'ocr': 'off'})
        def broken_clear(widget, writer, value, field, font_path):
            widget.canonical[NameObject('/V')] = TextStringObject(str(value))
        with patch.object(FormWidget, 'write_value', broken_clear):
            with self.assertRaisesRegex(ValueError, 'output_text_render_verification_failed'):
                fill_pdf_form(first, template, {'campaign_name': ''}, self.output)
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.root.glob('.filled-*.tmp')), [])

    def test_button_distinct_stream_bytes_without_a_visible_mark_are_rejected(self) -> None:
        _write_native_widgets_fixture(self.source)
        writer = PdfWriter(clone_from=self.source)
        normal = writer.pages[0]['/Annots'][0].get_object()['/AP']['/N']
        off, on = normal['/Off'].get_object(), normal['/Yes'].get_object()
        invisible = DecodedStreamObject()
        invisible.update({key: value for key, value in on.items()
                          if key not in {'/Length', '/Filter', '/DecodeParms'}})
        invisible.set_data(off.get_data() + b'\n% different bytes, identical pixels\n')
        normal[NameObject('/Yes')] = writer._add_object(invisible)
        writer.write(self.source)
        writer.close()
        with self.assertRaisesRegex(ValueError, 'output_appearance_verification_failed'):
            fill_pdf_form(self.source, analyze_pdf_form(self.source, {'ocr': 'off'}),
                          {'agree': True}, self.output)
        self.assertFalse(self.output.exists())
        self.assertEqual(list(self.root.glob('.filled-*.tmp')), [])

    def test_failed_later_field_preserves_an_existing_output_without_temporary_files(self) -> None:
        _blank_source(self.source)
        original_output = b'previous completed artifact'
        self.output.write_bytes(original_output)
        fields = [_field('good', (10, 10, 180, 20)), _field('bad', (10, 50, 1, 1))]
        with self.assertRaisesRegex(ValueError, 'field_text_overflow'):
            fill_pdf_form(self.source, _template(self.source, fields),
                          {'good': 'Valid field', 'bad': 'Does not fit'}, self.output)
        self.assertEqual(self.output.read_bytes(), original_output)
        self.assertEqual(list(self.root.glob('.filled-*.tmp')), [])

    def test_verification_failure_preserves_an_existing_output_and_cleans_temporary_file(self) -> None:
        _blank_source(self.source)
        original_output = b'previous completed artifact'
        self.output.write_bytes(original_output)
        with patch('write.pdf_form_engine.fill._verify_pdf_output', side_effect=ValueError('verification_failed')):
            with self.assertRaisesRegex(ValueError, 'verification_failed'):
                fill_pdf_form(self.source, _template(self.source, [_field('valid', (10, 10, 180, 20))]),
                              {'valid': 'Safe value'}, self.output)
        self.assertEqual(self.output.read_bytes(), original_output)
        self.assertEqual(list(self.root.glob('.filled-*.tmp')), [])


if __name__ == '__main__':
    unittest.main()
