# Document Write Engine

Node-side document **generation** (PDF→HTML template import, HTML→PDF, DOCX fill). Separate from the read pipeline in `document-engine/`.

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
  → document-write/html/render (Handlebars)
  → document-write/pdf/generate
  → DesktopPrintBridge
  → runtime ArtifactSink
  → generated/reports/<artifact-id>_<file-name> + metadata sidecar
```

The pure write engine returns PDF bytes to its caller; the document connector
adapter is responsible for persisting them and exposing only a safe artifact
reference to workflow state. Physical paths remain host-owned.

Read/parse: `packages/document-engine/` (Python) + `packages/core/src/document-engine/` (TS client).
