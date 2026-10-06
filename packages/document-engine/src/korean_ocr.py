from __future__ import annotations

import hashlib
import logging
import os
import sys
from functools import lru_cache
from pathlib import Path
from typing import Any

from artifact_store import atomic_write_bytes

_ENGINE: Any | None = None


def _quiet_rapidocr_logs() -> None:
    logging.getLogger("RapidOCR").setLevel(logging.WARNING)


_KOREAN_DICT_URL = (
    "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/"
    "paddle/PP-OCRv5/rec/korean_PP-OCRv5_rec_mobile/ppocrv5_korean_dict.txt"
)
_KOREAN_DICT_NAME = "ppocrv5_korean_dict.txt"
_KOREAN_REC_NAME = "korean_PP-OCRv5_rec_mobile.onnx"
# Pin the published digest here once it is verified out of band. While empty,
# the first download is recorded next to the file and later reads must match it.
_KOREAN_DICT_SHA256 = ""
_MAX_DICT_BYTES = 4 * 1024 * 1024
_DOWNLOAD_TIMEOUT_SECONDS = 60


class KoreanOcrModelUnavailable(RuntimeError):
    """Raised when a Korean OCR model is missing and may not be downloaded."""


def _models_dir() -> Path:
    """Models shipped inside the rapidocr package (read-only for us)."""
    import rapidocr

    return Path(rapidocr.__file__).resolve().parent / "models"


def _writable_models_dir() -> Path:
    """Per-user model cache; never inside site-packages."""
    from ax_paths import default_ax_data_root

    return default_ax_data_root() / "models" / "rapidocr"


def _model_download_allowed() -> bool:
    """Network model downloads are a developer convenience.

    Packaged builds start Python with ``-E`` (ignore_environment); there the
    download is disabled unless explicitly enabled with AX_ALLOW_OCR_MODEL_DOWNLOAD=1.
    """
    explicit = os.environ.get("AX_ALLOW_OCR_MODEL_DOWNLOAD", "").strip()
    if explicit:
        return explicit == "1"
    return not sys.flags.ignore_environment


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _verify_dict(path: Path) -> None:
    actual = _sha256(path)
    expected = _KOREAN_DICT_SHA256
    recorded = path.with_name(path.name + ".sha256")
    if not expected and recorded.is_file():
        expected = recorded.read_text(encoding="utf-8").strip()
    if expected and actual != expected:
        raise KoreanOcrModelUnavailable(f"korean_ocr_model_hash_mismatch:{path.name}")


def _first_existing(*candidates: Path) -> Path | None:
    return next((candidate for candidate in candidates if candidate.is_file()), None)


@lru_cache(maxsize=1)
def korean_rapidocr_model_paths() -> dict[str, str]:
    models = _models_dir()
    cache = _writable_models_dir()
    det = models / "ch_PP-OCRv5_det_mobile.onnx"
    cls = models / "ch_ppocr_mobile_v2.0_cls_mobile.onnx"
    rec = _first_existing(cache / _KOREAN_REC_NAME, models / _KOREAN_REC_NAME)
    if rec is None:
        if not _model_download_allowed():
            raise KoreanOcrModelUnavailable(f"korean_ocr_model_missing:{_KOREAN_REC_NAME}")
        # rapidocr fetches and verifies its own registered model files.
        _ensure_korean_engine()
        rec = models / _KOREAN_REC_NAME
    keys = _first_existing(cache / _KOREAN_DICT_NAME, models / _KOREAN_DICT_NAME)
    if keys is None:
        keys = cache / _KOREAN_DICT_NAME
        _download_korean_dict(keys)
    if keys.parent == cache:
        _verify_dict(keys)
    return {
        "det_model_path": str(det),
        "cls_model_path": str(cls),
        "rec_model_path": str(rec),
        "rec_keys_path": str(keys),
    }


def _download_korean_dict(dest: Path) -> None:
    if not _model_download_allowed():
        raise KoreanOcrModelUnavailable(f"korean_ocr_model_missing:{dest.name}")
    from urllib.request import urlopen

    dest.parent.mkdir(parents=True, exist_ok=True)
    with urlopen(_KOREAN_DICT_URL, timeout=_DOWNLOAD_TIMEOUT_SECONDS) as response:
        data = response.read(_MAX_DICT_BYTES + 1)
    if not data or len(data) > _MAX_DICT_BYTES:
        raise KoreanOcrModelUnavailable("korean_ocr_model_download_invalid")
    actual = hashlib.sha256(data).hexdigest()
    if _KOREAN_DICT_SHA256 and actual != _KOREAN_DICT_SHA256:
        raise KoreanOcrModelUnavailable("korean_ocr_model_hash_mismatch:" + dest.name)
    atomic_write_bytes(dest, data)
    if not _KOREAN_DICT_SHA256:
        atomic_write_bytes(dest.with_name(dest.name + ".sha256"), actual.encode("ascii"))
        logging.getLogger(__name__).warning("Recorded unpinned Korean OCR dictionary digest %s", actual)


def _ensure_korean_engine() -> None:
    from rapidocr import EngineType, LangDet, LangRec, ModelType, OCRVersion, RapidOCR

    RapidOCR(
        params={
            "Det.engine_type": EngineType.ONNXRUNTIME,
            "Det.lang_type": LangDet.CH,
            "Det.model_type": ModelType.MOBILE,
            "Det.ocr_version": OCRVersion.PPOCRV5,
            "Rec.engine_type": EngineType.ONNXRUNTIME,
            "Rec.lang_type": LangRec.KOREAN,
            "Rec.model_type": ModelType.MOBILE,
            "Rec.ocr_version": OCRVersion.PPOCRV5,
        }
    )


def get_korean_ocr_engine() -> Any:
    global _ENGINE
    if _ENGINE is not None:
        return _ENGINE
    from rapidocr import EngineType, LangDet, LangRec, ModelType, OCRVersion, RapidOCR

    _quiet_rapidocr_logs()
    if _first_existing(_writable_models_dir() / _KOREAN_REC_NAME, _models_dir() / _KOREAN_REC_NAME) is None:
        if not _model_download_allowed():
            raise KoreanOcrModelUnavailable(f"korean_ocr_model_missing:{_KOREAN_REC_NAME}")
        _ensure_korean_engine()
    _ENGINE = RapidOCR(
        params={
            "Det.engine_type": EngineType.ONNXRUNTIME,
            "Det.lang_type": LangDet.CH,
            "Det.model_type": ModelType.MOBILE,
            "Det.ocr_version": OCRVersion.PPOCRV5,
            "Rec.engine_type": EngineType.ONNXRUNTIME,
            "Rec.lang_type": LangRec.KOREAN,
            "Rec.model_type": ModelType.MOBILE,
            "Rec.ocr_version": OCRVersion.PPOCRV5,
        }
    )
    return _ENGINE


def ocr_image_path(path: Path) -> tuple[str, float | None]:
    engine = get_korean_ocr_engine()
    result = engine(str(path))
    if result is None:
        return "", None
    txts = getattr(result, "txts", None) or []
    scores = getattr(result, "scores", None) or []
    text = "\n".join(str(line).strip() for line in txts if str(line).strip()).strip()
    confidence = float(sum(scores) / len(scores)) if scores else None
    return text, confidence


def build_docling_korean_ocr_options():
    from docling.datamodel.pipeline_options import OcrMode, RapidOcrOptions

    paths = korean_rapidocr_model_paths()
    return RapidOcrOptions(
        mode=OcrMode.LAYOUT_REGIONS,
        backend="onnxruntime",
        det_model_path=paths["det_model_path"],
        cls_model_path=paths["cls_model_path"],
        rec_model_path=paths["rec_model_path"],
        rec_keys_path=paths["rec_keys_path"],
    )
