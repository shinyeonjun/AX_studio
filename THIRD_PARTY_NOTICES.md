# Third-party software in AX Studio

AX Studio includes third-party software under its respective license terms.
Those terms are not replaced by AX Studio's project license. This index is not
a grant of rights to the AX Studio source, and is not a substitute for the full
notices shipped with the dependencies.

## Where the full notices are installed

- **Electron:** `LICENSE.electron.txt` beside `AX Studio.exe`.
- **Chromium and its dependencies:** `LICENSES.chromium.html` in the same folder.
- **JavaScript dependencies:** license, notice, copyright and README files under
  `resources/app.asar/node_modules`. `app.asar` is an Electron archive; use
  `@electron/asar` to inspect it. Dependency `package.json` files record exact
  versions and declared licenses. The source checkout's `package-lock.json`
  records the dependency resolutions used to build the application.
- **Python:** `resources/document-engine/python/LICENSE.txt`.
- **Python packages and native libraries:** notices under
  `resources/document-engine/python/Lib/site-packages`, including package
  `*.dist-info` directories, their `licenses` subdirectories, and the PDFium and
  OpenCV license directories/files. `METADATA` files identify installed versions.

Keep these files with any redistribution. Some dependencies contain additional
third-party components with their own notices (notably Chromium, PDFium, NumPy
and OpenCV); do not keep only the top-level library license.

## PDF engine licensing

The current document engine uses **PyMuPDF and MuPDF**, available under AGPL or a
commercial agreement. Their AGPL text is included in the PyMuPDF distribution's
`COPYING` file. Source availability and other applicable obligations need to be
reviewed before distributing AX Studio with these components. Merely publishing
a GitHub repository or this notice does not by itself establish compliance.

Official licensing information:

- [PyMuPDF / MuPDF](https://pymupdf.readthedocs.io/en/latest/about.html#license-and-copyright)
- [GNU AGPL version 3](https://www.gnu.org/licenses/agpl-3.0.html)

The document engine also uses pypdf, pypdfium2, ReportLab, Pillow, OpenCV and their
dependencies. Their original notices remain in the packaged Python environment.
Optional Docling/OCR development dependencies are not part of the default bundle.

## External services

AI services, Gmail and Slack are external services. Their accounts, credentials,
usage charges and terms are separate from the licenses of this application and
its bundled libraries. No service subscription or account access is conveyed by
downloading AX Studio.
