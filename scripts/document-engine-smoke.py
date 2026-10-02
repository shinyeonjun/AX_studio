"""Offline acceptance for the relocated packaged runtime, never host Python."""
import hashlib
import importlib.metadata
import importlib.util
import json
from pathlib import Path
import sys

import cv2
import numpy as np
import PIL
import pypdf
import pypdfium2
import reportlab
from reportlab.pdfgen import canvas

runtime = Path(sys.argv[1]).resolve()
scratch = Path(sys.argv[2]).resolve()
assert Path(sys.executable).resolve().is_relative_to(runtime), sys.executable
assert Path(sys.prefix).resolve() == runtime, sys.prefix
assert sys.version_info[:3] == (3, 13, 15), sys.version
for module in (cv2, np, PIL, pypdf, pypdfium2, reportlab):
    assert Path(module.__file__).resolve().is_relative_to(runtime), module.__file__
assert not any(".venv" in path for path in sys.path), sys.path
for name in ("pymupdf", "fitz"):
    assert importlib.util.find_spec(name) is None, f"Forbidden packaged PDF module: {name}"
for distribution in importlib.metadata.distributions():
    name = distribution.metadata.get("Name", "").lower().replace("_", "-")
    assert name not in {"pymupdf", "pymupdfb", "mupdf", "fitz"}, f"Forbidden packaged distribution: {name}"
assert importlib.metadata.version("pypdf") == "6.19.0"
assert importlib.metadata.version("pypdfium2") == "5.13.0"

source_root = runtime.parent / "src"
sys.path.insert(0, str(source_root))
from artifact_store import sha256_file
from write.pdf_form import analyze_pdf_form, fill_pdf_form
from write.pdf_form_engine.widgets import FormWidget, appearance_pdf
from write.pdf_read import open_pdf, page_text, render_page
for module_name in ("artifact_store", "write.pdf_form", "write.pdf_read"):
    assert Path(sys.modules[module_name].__file__).resolve().is_relative_to(source_root)

fonts = source_root / "assets" / "fonts"
font_hashes = {
    "NanumGothic-Regular.ttf": "76f45ef4a6bcff344c837c95a7dcc26e017e38b5846d5ae0cdcb5b86be2e2d31",
    "NotoSansCJKsc-VF.ttf": "990c807e79c25662a5a9ecf7f971baeb2bf2eab9a559e5ecf15cdfdb8561d21f",
}
for name, expected in font_hashes.items():
    assert hashlib.sha256((fonts / name).read_bytes()).hexdigest() == expected, name
for name in ("OFL.txt", "NotoSansCJK-OFL.txt", "README.md"):
    assert (fonts / name).stat().st_size > 100, name

mixed = "한국어 中文測試 日本語テスト café"
pdf = scratch / "sample 한글.pdf"
writer = canvas.Canvas(str(pdf))
writer.drawString(72, 760, "AX packaged document smoke")
writer.acroForm.textfield(name="mixed", x=72, y=700, width=410, height=28, forceBorder=True)
writer.acroForm.checkbox(name="agree", x=72, y=660, size=20, forceBorder=True)
writer.showPage()
writer.save()
assert "AX packaged document smoke" in pypdf.PdfReader(str(pdf)).pages[0].extract_text()
source_hash = sha256_file(pdf)
filled = scratch / "filled native 한글.pdf"
result = fill_pdf_form(pdf, analyze_pdf_form(pdf, {"ocr": "off"}), {"mixed": mixed, "agree": True}, filled)
assert result["writerEngine"] == "pypdf-reportlab" and result["verified"] and result["interactive"]
assert sha256_file(pdf) == source_hash and not list(scratch.glob(".filled native 한글-*.tmp"))
reader = pypdf.PdfReader(filled)
assert reader.get_fields()["mixed"]["/V"] == mixed
assert reader.get_fields()["agree"]["/V"] == "/Yes"
raw_widget = reader.pages[0]["/Annots"][0].get_object()
with open_pdf(appearance_pdf(FormWidget(raw_widget, float(reader.pages[0].mediabox.height)))) as document:
    page = document[0]
    try:
        assert mixed in page_text(page)
        image = render_page(page)
        try:
            assert image.convert("L").getextrema()[0] < 255
        finally:
            image.close()
    finally:
        page.close()

# Test the saved overlay on every rotation, not a host- or generated-image fallback.
rotated = scratch / "rotated source.pdf"
structure = pypdf.PdfWriter()
for rotation in (0, 90, 180, 270):
    structure.add_blank_page(300, 200).rotate(rotation)
structure.write(rotated)
structure.close()
fields = [{"id": f"page-{index}", "name": f"page-{index}", "pageIndex": index,
           "type": "text", "source": "layout_hint", "fontSize": 8.3,
           "rect": {"x": 2, "y": 180, "width": 296, "height": 20}}
          for index in range(4)]
template = {"schemaVersion": 1, "coordinateSpace": "pdf-user-top-left-unrotated",
            "sourceHash": sha256_file(rotated), "pageCount": 4, "mode": "digital", "fields": fields,
            "pages": [{"index": index, "width": 300, "height": 200, "rotation": rotation}
                      for index, rotation in enumerate((0, 90, 180, 270))]}
overlay = scratch / "rotated filled.pdf"
result = fill_pdf_form(rotated, template, {field["id"]: mixed for field in fields}, overlay)
assert result["verified"] and not result["interactive"]
assert [page.rotation for page in pypdf.PdfReader(overlay).pages] == [0, 90, 180, 270]
with open_pdf(overlay) as document:
    for index in range(4):
        page = document[index]
        try:
            assert mixed in page_text(page)
            image = render_page(page, scale=1)
            try:
                gray = cv2.cvtColor(np.asarray(image), cv2.COLOR_RGB2GRAY)
                assert gray.shape[0] > 100 and int(gray.min()) < int(gray.max())
            finally:
                image.close()
        finally:
            page.close()

print(json.dumps({"python": sys.version.split()[0], "relocated": True, "pdf": str(pdf),
                  "writerEngine": "pypdf-reportlab", "nativeFormVerified": True,
                  "rotationsVerified": [0, 90, 180, 270], "mixedCjkLatinVerified": True,
                  "forbiddenPdfModulesAbsent": True, "fontSha256": font_hashes,
                  "distributions": {name: importlib.metadata.version(name) for name in
                                    ("pypdf", "pypdfium2", "reportlab", "Pillow", "opencv-python-headless", "numpy")}}))
