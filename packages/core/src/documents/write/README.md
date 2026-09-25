# Document Write Engine

Node-side document **generation** (PDF→HTML template import, HTML→PDF, DOCX fill). Source-authoritative PDF form analysis/fill is delegated to the Python document engine. Separate from the read pipeline in `documents/read/`.

## Layout

| Path | Role |
|------|------|
| `pdf/to-html.ts` | PDF → HTML template import (Docling via Python worker) |
| `html/render.ts` | Handlebars → HTML string |
| `pdf/generate.ts` | HTML → PDF (via `DesktopPrintBridge`) |
| `docx/fill.ts` | Docxtemplater template fill |
| `desktop-print.ts` | Injectable bridge — Electron Chromium `printToPDF` |

## Template import flow

```text
document.pdf.toHtml
  → importPdfTemplate()
  → DocumentEngineClient.pdfToHtml  →  worker pdf_to_html (Docling export_to_html)
  → ~/.ax-studio/templates/<hash>/
       original.pdf | template.html | meta.json
```

## Report render flow

```text
ReportData(JSON) + templateHtml
  → documents/write/html/render (Handlebars)
  → documents/write/pdf/generate
  → DesktopPrintBridge
  → runtime ArtifactSink
  → generated/reports/<artifact-id>_<file-name> + metadata sidecar
```

The pure write engine returns PDF bytes to its caller; the document connector
adapter is responsible for persisting them and exposing only a safe artifact
reference to workflow state. Physical paths remain host-owned.

## Import boundary

The core root entry keeps document-write types and the print bridge, but does
not re-export the writer implementations so applications that do not generate
documents do not load Handlebars or DOCX dependencies at startup. Import writer
functions from `@ax-studio/core/documents/write` (for example,
`import { renderHtml } from '@ax-studio/core/documents/write'`). The connector
loads the HTML, DOCX, or PDF implementation when that action is executed.

Read/parse: `packages/document-engine/` (Python) + `packages/core/src/documents/read/` (TS client). Semantic PDF reads use Docling when available; source-authoritative PDF form writes use the Python worker's PyMuPDF path and publish only verified output. PDF→HTML remains an explicit editable preview/export route.
