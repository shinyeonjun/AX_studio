# Packaging notices

AX Studio-authored source is licensed under the root `LICENSE` (MIT). Third-party components retain their own licenses. Keep the full notices supplied with each component; this index does not replace them.

Required packaged notice locations:

- Project license: `resources/LICENSE.AX-Studio.txt`
- Third-party index: `resources/THIRD_PARTY_NOTICES.md`
- This notice: `resources/PACKAGING_NOTICES.md`
- Electron: `LICENSE.electron.txt` beside the executable
- Chromium and bundled components: `LICENSES.chromium.html`
- JavaScript packages: their license, notice, copyright, README, and version metadata within `resources/app.asar/node_modules`
- Windows Python: `resources/document-engine/python/LICENSE.txt`
- Linux Python: `resources/document-engine/python/lib/python3.13/LICENSE.txt`
- Linux Python native runtime components: the matching full-build `PYTHON.json` and complete `licenses/` tree under `resources/document-engine/python/runtime-notices/`
- Python dependencies: complete installed package and `*.dist-info` license metadata within the bundled `site-packages`, including nested PDFium, OpenCV, NumPy, Pillow, ReportLab, and pypdf notices
- Bundled Nanum Gothic and Noto Sans CJK fonts: their unchanged SIL OFL 1.1 licenses, copyright/reserved-name notices, and provenance under `resources/document-engine/src/assets/fonts/`

The default PDF backend uses pypdf, ReportLab, and pypdfium2/PDFium. It does not include PyMuPDF/MuPDF. Optional Docling/OCR packages are outside the default bundle and require their own notices if added.

See the root `THIRD_PARTY_NOTICES.md` and each dependency's complete license terms before redistribution.
