"""Synthetic PDF written and read using only the installed document engine."""
import hashlib
import json
from pathlib import Path
import sys

runtime = Path(sys.argv[1]).resolve()
destination = Path(sys.argv[2]).resolve()
assert Path(sys.executable).resolve().is_relative_to(runtime)
assert Path(sys.prefix).resolve() == runtime
assert not any('.venv' in part for part in sys.path)
import pypdf
import pypdfium2
import reportlab
from reportlab.pdfgen import canvas

for module in (pypdf, pypdfium2, reportlab):
    assert Path(module.__file__).resolve().is_relative_to(runtime)
engine_source = runtime.parent / 'src'
sys.path.insert(0, str(engine_source))
from write.pdf_read import open_pdf, page_text
assert Path(sys.modules['write.pdf_read'].__file__).resolve().is_relative_to(engine_source)
marker = 'AX installed synthetic PDF'
writer = canvas.Canvas(str(destination))
writer.drawString(72, 760, marker)
writer.save()
assert destination.read_bytes().startswith(b'%PDF-')
assert marker in pypdf.PdfReader(destination).pages[0].extract_text()
with open_pdf(destination) as document:
    assert len(document) == 1
    page = document[0]
    try:
        assert marker in page_text(page)
    finally:
        page.close()
print(json.dumps({'installedRuntime': True, 'writer': 'reportlab', 'reader': 'installed-write.pdf_read',
                  'pageCount': 1, 'sha256': hashlib.sha256(destination.read_bytes()).hexdigest()}))
