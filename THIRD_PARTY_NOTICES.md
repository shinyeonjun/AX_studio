# Third-party software in AX Studio

AX Studio-authored source code is licensed under the [MIT License](LICENSE).
Third-party software remains under its respective license terms; the project
license does not replace those terms or relicense bundled dependencies. This
index is not a substitute for the full notices shipped with the dependencies.

## Where the full notices are installed

- **AX Studio:** `resources/LICENSE.AX-Studio.txt`.
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

The default document engine uses pypdf for PDF structure and AcroForm values,
ReportLab for text and appearance streams, and pypdfium2/PDFium for independent
rendering and inspection. PyMuPDF/MuPDF is not a dependency of this build; the
packaging acceptance check rejects their modules or distributions.

- **pypdf:** BSD-3-Clause; see its installed distribution license.
- **ReportLab:** BSD license; see its installed distribution license.
- **pypdfium2:** Apache-2.0 OR BSD-3-Clause. PDFium and its bundled components
  have their own notices, retained inside the installed pypdfium2 packages.
- **Nanum Gothic:** unmodified font under SIL Open Font License 1.1, including
  its copyright and reserved font names. The font, upstream revision/hash and
  full license are at `resources/document-engine/src/assets/fonts/`.
  Keep `OFL.txt` with the font. The font is not relicensed under MIT.

Pillow, OpenCV, NumPy and other runtime dependencies retain their original
notices in the packaged Python environment. Optional Docling/OCR development
dependencies are not part of the default bundle and require a separate review
if added to a distribution.

## External services

AI services, Gmail and Slack are external services. Their accounts, credentials,
usage charges and terms are separate from the licenses of this application and
its bundled libraries. No service subscription or account access is conveyed by
downloading AX Studio.
