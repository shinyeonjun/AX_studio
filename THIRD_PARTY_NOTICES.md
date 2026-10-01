# Third-party software in AX Studio

AX Studio-authored source code is licensed under the [MIT License](LICENSE).
Third-party software remains under its respective license terms. The project
license does not replace those terms or relicense bundled dependencies. This
index is not a substitute for the full notices shipped with dependencies.

## Where full notices belong in packaged builds

- AX Studio: `resources/LICENSE.AX-Studio.txt`
- This index: `resources/THIRD_PARTY_NOTICES.md`
- Packaging/runtime layout: `resources/PACKAGING_NOTICES.md`
- Electron: `LICENSE.electron.txt` beside the executable
- Chromium and bundled dependencies: `LICENSES.chromium.html` beside the executable
- JavaScript dependencies: license, notice, copyright and README files under
  `resources/app.asar/node_modules`. Inspect this Electron archive with
  `@electron/asar`; package metadata and the source lockfile identify versions
- Windows Python: `resources/document-engine/python/LICENSE.txt`
- Linux Python: `resources/document-engine/python/lib/python3.13/LICENSE.txt`
- Linux Python's native runtime notices: the matching full-build `PYTHON.json`
  and complete `licenses/` tree in `resources/document-engine/python/runtime-notices/`
- Windows Python packages: `resources/document-engine/python/Lib/site-packages`
- Linux Python packages: `resources/document-engine/python/lib/python3.13/site-packages`
- Fonts and their full licenses: `resources/document-engine/src/assets/fonts/`

Retain installed package trees, `*.dist-info` metadata and license directories,
including nested native-library notices for Chromium, PDFium, NumPy and OpenCV.
Keep these files with redistribution; a top-level library license alone may not
cover all bundled components.

## PDF engine licensing

The default document engine uses pypdf for PDF structure and AcroForm values,
ReportLab for overlays and saved appearance streams, and pypdfium2/PDFium for
independent rendering and inspection. PyMuPDF/MuPDF is not a dependency of this
backend.

- pypdf: BSD-3-Clause; retain the installed distribution's full license
- ReportLab: BSD license; retain the installed distribution's full license
- pypdfium2: Apache-2.0 OR BSD-3-Clause. PDFium and its bundled components have
  additional notices retained within the installed pypdfium2 packages
- Nanum Gothic and Noto Sans CJK: unmodified fonts under SIL Open Font License
  1.1. Their copyright, reserved names, exact upstream revisions and hashes are
  documented alongside the assets. Keep `OFL.txt` and `NotoSansCJK-OFL.txt` with
  the respective fonts; neither font is relicensed under MIT

Pillow, OpenCV, NumPy and other runtime dependencies retain their original
notices in the Python environment. Optional Docling/OCR dependencies are not in
the default bundle and require separate review if added to a distribution.

## External services

AI services, Gmail and Slack are external services. Their accounts, credentials,
usage charges and terms are separate from application/library licenses. No
service subscription or account access is conveyed by downloading AX Studio.
