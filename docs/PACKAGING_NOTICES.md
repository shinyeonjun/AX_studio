# Packaging notices for the planner branch

This branch's default PDF engine includes **PyMuPDF/MuPDF**. PyMuPDF's upstream
license is AGPL-3.0 or a commercial license; shipping a binary needs a separate
license/distribution decision. Creating and testing a local package does not
establish that redistribution is approved or that obligations have been met.
Do not copy the preview release's claim that PyMuPDF is absent onto this branch.
The PDF backend and dependency ranges are intentionally unchanged by the Linux
packaging work. Optional Docling/OCR packages are not in the default bundle.

The root project LICENSE and the preview release's THIRD_PARTY_NOTICES need to
be reconciled on this branch before publication. This notice does not grant a
new project license or replace any dependency's license terms.

## Retained runtime notices

- Electron: `LICENSE.electron.txt` next to the application executable
- Chromium and bundled dependencies: `LICENSES.chromium.html`
- JavaScript packages: license/notice files and exact-version package metadata
  inside `resources/app.asar/node_modules`; inspect using `@electron/asar`
- Windows Python: `resources/document-engine/python/LICENSE.txt`
- Linux Python: `resources/document-engine/python/lib/python3.13/LICENSE.txt`
- Linux Python's statically linked libraries: the matching, checksum-verified
  Astral full-build `PYTHON.json` and complete `licenses/` directory retained at
  `resources/document-engine/python/runtime-notices/`
- Python packages and native libraries: full installed package trees and
  `*.dist-info` metadata/licenses under the bundled Python site-packages,
  including PDFium, MuPDF, OpenCV, NumPy, Pillow, ReportLab and pypdf notices
- Document engine assets: their existing notice and license files remain with
  the copied source/assets tree

Keep these notices with any approved redistribution. The local package checks
verify presence and runtime behavior; they are not a legal clearance, complete
software bill of materials, security audit, or a fresh-machine certification.
