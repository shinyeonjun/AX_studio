"""Acceptance check executed by the isolated, packaged Python interpreter."""
from __future__ import annotations

import hashlib
import importlib.metadata
import importlib.util
import json
import sys
from pathlib import Path

import cv2
import pypdfium2
from pypdf import PdfReader
from reportlab.pdfgen import canvas

from write.pdf_form import analyze_pdf_form, fill_pdf_form


def main() -> None:
    root = Path(sys.argv[1])
    for module in ("pymupdf", "fitz"):
        if importlib.util.find_spec(module) is not None:
            raise RuntimeError("Forbidden legacy PDF engine in bundle: " + module)
    distributions = {dist.metadata["Name"].lower(): dist.version for dist in importlib.metadata.distributions()}
    if any(name in distributions for name in ("pymupdf", "pymupdfb", "mupdf", "fitz")):
        raise RuntimeError("Forbidden legacy PDF distribution in bundle")
    from write.pdf_form_engine.fonts import _BUNDLED_FONT
    if hashlib.sha256(_BUNDLED_FONT.read_bytes()).hexdigest() != "76f45ef4a6bcff344c837c95a7dcc26e017e38b5846d5ae0cdcb5b86be2e2d31":
        raise RuntimeError("Bundled font integrity mismatch")
    if "SIL OPEN FONT LICENSE" not in _BUNDLED_FONT.with_name("OFL.txt").read_text(encoding="utf-8"):
        raise RuntimeError("Bundled font license missing")
    value = "한글 입력 AX"
    for native in (False, True):
        source = root / ("native.pdf" if native else "overlay.pdf")
        output = root / ("native-filled.pdf" if native else "overlay-filled.pdf")
        drawing = canvas.Canvas(str(source))
        drawing.drawString(72, 780, "AX packaged document smoke")
        if native:
            drawing.acroForm.textfield(name="name", x=72, y=720, width=250, height=30)
        else:
            drawing.drawString(72, 720, "[[name]]")
        drawing.showPage()
        drawing.save()
        digest = hashlib.sha256(source.read_bytes()).hexdigest()
        result = fill_pdf_form(source, analyze_pdf_form(source, {"ocr": "off"}), {"name": value}, output)
        if not result["verified"] or result["writerEngine"] != "pypdf-reportlab":
            raise RuntimeError("Packaged form write not verified")
        if hashlib.sha256(source.read_bytes()).hexdigest() != digest:
            raise RuntimeError("Packaged form write changed source")
        reader = PdfReader(output)
        if native:
            if reader.get_fields()["name"]["/V"] != value:
                raise RuntimeError("Packaged native form value mismatch")
        elif value not in " ".join(reader.pages[0].extract_text().split()):
            raise RuntimeError("Packaged Korean overlay missing")
    print(json.dumps({"python": sys.version.split()[0], "packages": distributions,
                      "checks": ["no-legacy-pdf-engine", "font-license-and-hash", "korean-overlay",
                                 "interactive-korean-form", "source-preservation"]}, sort_keys=True))


if __name__ == "__main__":
    main()
