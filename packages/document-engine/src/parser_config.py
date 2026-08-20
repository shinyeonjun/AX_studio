from __future__ import annotations

PARSER_CONFIG_VERSION = "3"


def parser_cache_fingerprint() -> dict[str, str]:
    try:
        import docling

        docling_version = getattr(docling, "__version__", "unknown")
    except Exception:
        docling_version = "unknown"
    return {
        "parserConfigVersion": PARSER_CONFIG_VERSION,
        "doclingVersion": docling_version,
        "ocrBackend": "rapidocr-onnxruntime",
        "ocrModel": "PP-OCRv5-korean",
    }
