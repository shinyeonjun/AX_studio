import unittest
from unittest import mock

from pypdf import PdfWriter
from pypdf.generic import ArrayObject, DecodedStreamObject, DictionaryObject, FloatObject, NameObject

from write.pdf_form_engine import placeholders


def _form(writer: PdfWriter, content: bytes, xobjects: DictionaryObject | None = None):
    stream = DecodedStreamObject()
    stream.set_data(content)
    stream.update({
        NameObject("/Type"): NameObject("/XObject"),
        NameObject("/Subtype"): NameObject("/Form"),
        NameObject("/BBox"): ArrayObject([FloatObject(0), FloatObject(0), FloatObject(10), FloatObject(10)]),
        NameObject("/Resources"): DictionaryObject({NameObject("/XObject"): xobjects or DictionaryObject()}),
    })
    return writer._add_object(stream)


class PlaceholderRewriteBudgetTest(unittest.TestCase):
    def test_nested_form_xobject_fan_out_is_bounded(self) -> None:
        writer = PdfWriter()
        page = writer.add_blank_page(width=100, height=100)
        # Three levels of a form that invokes its child four times: 4 + 16 + 64 rewrites.
        leaf = _form(writer, b"")
        child = leaf
        for _ in range(3):
            child = _form(writer, b"/C Do " * 4, DictionaryObject({NameObject("/C"): child}))
        page[NameObject("/Resources")] = DictionaryObject({
            NameObject("/XObject"): DictionaryObject({NameObject("/C"): child}),
        })
        contents = DecodedStreamObject()
        contents.set_data(b"/C Do " * 4)
        page[NameObject("/Contents")] = writer._add_object(contents)

        with mock.patch.object(placeholders, "_MAX_CONTENT_REWRITES", 20):
            with self.assertRaisesRegex(ValueError, "pdf_content_too_complex"):
                placeholders.remove_placeholders(page, writer, [])


if __name__ == "__main__":
    unittest.main()
