from pathlib import Path
import unittest
from unittest.mock import patch

from adapters.docling_engine.structure import (
    _classify_page,
    _ensure_visual_page_images,
)


class DoclingStructureHelperTest(unittest.TestCase):
    def test_native_page_classification_resolves_ocr_helper(self) -> None:
        page_type = _classify_page(0, "native text " * 4, 0, 0, 0)

        self.assertEqual(page_type, "native")

    @patch("adapters.docling_engine.structure._save_page_image", return_value=None)
    def test_visual_page_preparation_resolves_render_scale(self, save_page_image) -> None:
        page = {"index": 0, "sourceType": "scan"}

        _ensure_visual_page_images(
            object(),
            [page],
            [],
            Path("unused-images"),
            Path("sample.pdf"),
        )

        save_page_image.assert_called_once()
        self.assertNotIn("imagePath", page)


if __name__ == "__main__":
    unittest.main()
