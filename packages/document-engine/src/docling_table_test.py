import unittest

from adapters.docling import _backfill_empty_tables, _looks_like_garbage_ocr, _table_like_ocr_excerpt


class DoclingTableBackfillTest(unittest.TestCase):
    def test_table_like_ocr_excerpt_extracts_invoice_rows(self) -> None:
        ocr_text = (
            "CloudOps 정산서-2026년 6월\n"
            "GPU Worker\n5,400,000원\n"
            "Object Storage\n2,180,000원\n"
            "총 청구액\n12,460,000원\n"
        )
        excerpt = _table_like_ocr_excerpt(ocr_text)
        self.assertIn("GPU Worker", excerpt)
        self.assertIn("5,400,000원", excerpt)
        self.assertIn("12,460,000원", excerpt)

    def test_backfill_empty_tables_uses_page_ocr(self) -> None:
        tables = [{"id": "tbl1", "pageIndex": 5, "text": ""}]
        images = [
            {
                "id": "page5",
                "pageIndex": 5,
                "ocrText": "CloudOps 정산서\nGPU Worker\n5,400,000원\n총 청구액\n12,460,000원",
            }
        ]
        _backfill_empty_tables(tables, images)
        self.assertTrue(tables[0]["text"])
        self.assertEqual(tables[0]["sourceType"], "ocr")

    def test_latin_native_text_is_not_misclassified_as_garbage_ocr(self) -> None:
        self.assertFalse(_looks_like_garbage_ocr("This is a normal native PDF paragraph with no Korean text."))


if __name__ == "__main__":
    unittest.main()
