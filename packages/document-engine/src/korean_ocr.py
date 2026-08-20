from __future__ import annotations

import logging
from functools import lru_cache
from pathlib import Path
from typing import Any

_ENGINE: Any | None = None


def _quiet_rapidocr_logs() -> None:
    logging.getLogger("RapidOCR").setLevel(logging.WARNING)


def _models_dir() -> Path:
    import rapidocr

    return Path(rapidocr.__file__).resolve().parent / "models"


@lru_cache(maxsize=1)
def korean_rapidocr_model_paths() -> dict[str, str]:
    models = _models_dir()
    det = models / "ch_PP-OCRv5_det_mobile.onnx"
    cls = models / "ch_ppocr_mobile_v2.0_cls_mobile.onnx"
    rec = models / "korean_PP-OCRv5_rec_mobile.onnx"
    keys = models / "ppocrv5_korean_dict.txt"
    if not rec.is_file():
        _ensure_korean_engine()
    if not keys.is_file():
        _download_korean_dict(keys)
    return {
        "det_model_path": str(det),
        "cls_model_path": str(cls),
        "rec_model_path": str(rec),
        "rec_keys_path": str(keys),
    }


def _download_korean_dict(dest: Path) -> None:
    from urllib.request import urlretrieve

    url = (
        "https://www.modelscope.cn/models/RapidAI/RapidOCR/resolve/v3.9.2/"
        "paddle/PP-OCRv5/rec/korean_PP-OCRv5_rec_mobile/ppocrv5_korean_dict.txt"
    )
    dest.parent.mkdir(parents=True, exist_ok=True)
    urlretrieve(url, dest)


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
