"""Offline acceptance for the *relocated packaged* runtime, never host Python."""
import importlib.metadata
import json
from pathlib import Path
import sys

import cv2
import numpy as np
import pymupdf
import pypdf
import pypdfium2
from reportlab.pdfgen import canvas

runtime = Path(sys.argv[1]).resolve()
scratch = Path(sys.argv[2]).resolve()
assert Path(sys.executable).resolve().is_relative_to(runtime), sys.executable
assert Path(sys.prefix).resolve() == runtime, sys.prefix
assert sys.version_info[:3] == (3, 13, 15), sys.version
for module in (cv2, np, pymupdf, pypdf, pypdfium2):
    assert Path(module.__file__).resolve().is_relative_to(runtime), module.__file__
assert not any(".venv" in path for path in sys.path), sys.path
pdf = scratch / "sample 한글.pdf"
writer = canvas.Canvas(str(pdf))
writer.drawString(72, 720, "AX packaged document smoke")
writer.save()
assert "AX packaged document smoke" in pypdf.PdfReader(str(pdf)).pages[0].extract_text()
with pymupdf.open(pdf) as document:
    assert "AX packaged document smoke" in document[0].get_text()
    assert document[0].get_pixmap().width > 100
document = pypdfium2.PdfDocument(str(pdf))
try:
    page = document[0]
    bitmap = page.render(scale=1)
    try:
        image = np.asarray(bitmap.to_pil())
        assert cv2.cvtColor(image, cv2.COLOR_RGB2GRAY).shape[0] > 100
    finally:
        bitmap.close()
        page.close()
finally:
    document.close()
print(json.dumps({"python": sys.version.split()[0], "relocated": True, "pdf": str(pdf),
                  "distributions": {name: importlib.metadata.version(name) for name in
                                    ("pypdf", "pypdfium2", "PyMuPDF", "reportlab", "Pillow", "opencv-python-headless", "numpy")}}))
