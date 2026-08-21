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
  → report.pdf
```

Read/parse: `packages/document-engine/` (Python) + `packages/core/src/document-engine/` (TS client).
