import os
import tempfile
import unittest
from pathlib import Path
from unittest import mock

import korean_ocr


class KoreanOcrModelPolicyTest(unittest.TestCase):
    def test_download_is_disabled_when_explicitly_turned_off(self) -> None:
        with mock.patch.dict(os.environ, {"AX_ALLOW_OCR_MODEL_DOWNLOAD": "0"}):
            self.assertFalse(korean_ocr._model_download_allowed())
            with tempfile.TemporaryDirectory() as tmp, mock.patch("urllib.request.urlopen") as urlopen:
                with self.assertRaisesRegex(korean_ocr.KoreanOcrModelUnavailable, "korean_ocr_model_missing"):
                    korean_ocr._download_korean_dict(Path(tmp) / "dict.txt")
                urlopen.assert_not_called()

    def test_writable_models_dir_is_under_the_app_data_root(self) -> None:
        with tempfile.TemporaryDirectory() as tmp, mock.patch.dict(os.environ, {"AX_DATA_ROOT": tmp}):
            self.assertEqual(korean_ocr._writable_models_dir(), Path(tmp) / "models" / "rapidocr")

    def test_recorded_digest_detects_a_tampered_dictionary(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            dictionary = Path(tmp) / "dict.txt"
            dictionary.write_text("가\n나\n", encoding="utf-8")
            dictionary.with_name("dict.txt.sha256").write_text("0" * 64, encoding="utf-8")
            with self.assertRaisesRegex(korean_ocr.KoreanOcrModelUnavailable, "hash_mismatch"):
                korean_ocr._verify_dict(dictionary)


if __name__ == "__main__":
    unittest.main()
