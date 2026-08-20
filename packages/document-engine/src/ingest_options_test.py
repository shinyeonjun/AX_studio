import unittest

from ingest_options import cache_usable, normalize_ocr
from parser_config import PARSER_CONFIG_VERSION, parser_cache_fingerprint


class IngestOptionsTest(unittest.TestCase):
    def test_normalize_ocr_modes(self) -> None:
        self.assertEqual(normalize_ocr(None), "auto")
        self.assertEqual(normalize_ocr("auto"), "auto")
        self.assertEqual(normalize_ocr("off"), "off")
        self.assertEqual(normalize_ocr("force"), "force")
        self.assertEqual(normalize_ocr(False), "off")
        self.assertEqual(normalize_ocr(True), "force")
        self.assertEqual(normalize_ocr("false"), "off")

    def test_rejects_basic_cache_when_docling_is_resolved(self) -> None:
        manifest = {"engine": "basic", "ocrMode": "auto", **parser_cache_fingerprint()}
        self.assertFalse(
            cache_usable(
                manifest,
                requested_engine="auto",
                requested_ocr="auto",
                resolved_engine="docling",
            )
        )

    def test_rejects_old_manifest_without_parser_config(self) -> None:
        manifest = {"engine": "docling", "ocrMode": "auto"}
        self.assertFalse(
            cache_usable(
                manifest,
                requested_engine="docling",
                requested_ocr="auto",
                resolved_engine="docling",
            )
        )

    def test_reuses_matching_docling_auto_cache(self) -> None:
        manifest = {"engine": "docling", "ocrMode": "auto", **parser_cache_fingerprint()}
        self.assertTrue(
            cache_usable(
                manifest,
                requested_engine="auto",
                requested_ocr="auto",
                resolved_engine="docling",
            )
        )

    def test_rejects_ocr_mode_mismatch(self) -> None:
        manifest = {"engine": "docling", "ocrMode": "force", **parser_cache_fingerprint()}
        self.assertFalse(
            cache_usable(
                manifest,
                requested_engine="docling",
                requested_ocr="auto",
                resolved_engine="docling",
            )
        )

    def test_parser_config_version_is_set(self) -> None:
        self.assertEqual(parser_cache_fingerprint()["parserConfigVersion"], PARSER_CONFIG_VERSION)


if __name__ == "__main__":
    unittest.main()
