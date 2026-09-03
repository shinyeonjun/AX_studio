# Document connector

Workflow connector for document **read** and **write**. Catalog IDs stay `document.*`; code is split by engine.

## Layout

| Area | Engine | Connector | Capabilities |
|------|--------|-----------|--------------|
| **Read** | `document-engine/` (Python + TS client) | `read/` | `document.ingest`, `document.getChunk`, `document.getPage`, `document.search` |
| **Write** | `document-write/` (Node) + `document-engine/` (Python form path) | `write/` | `document.html.render`, `document.pdf.generate`, `document.docx.fill`, `document.pdf.toHtml`, `document.pdf.form.analyze`, `document.pdf.form.fill` |
| **Planned** | — | `planned/` (reserved) | txt, markdown, google-drive, notion |

## Data flow

### Read (PDF → text)

```text
trigger (local_folder / manual)
  → modules/document/read/  (resolveDocumentIngestExecution)
  → document-engine/ TS client  →  Python worker (Docling | Basic)
  → DocumentArtifact (contracts/artifacts/document.ts)
  → ai_decision (summary)
  → slack.message.send | gmail.message.send
```

Ingest path resolution: `contracts/document-ingest-resolve.ts`.

For PDF reads, `document.ingest` uses Docling when the configured adapter is
available. `auto` falls back to the Basic adapter only when Docling is not
available or fails; this fallback is observable in the returned engine data.
The PDF form analyzer has an additional geometry/OCR path because semantic
text extraction alone cannot identify the exact rectangles that must be filled.

Setup: `packages/document-engine/README.md`.

Dev ingest (avoid PowerShell JSON encoding):

```bash
cd packages/document-engine
.venv/Scripts/python.exe scripts/ingest-test.py path/to/file.pdf --artifact-root ./out
```

### Write — template import (PDF → HTML)

```text
document.pdf.toHtml
  → document-write/pdf/to-html  →  Python worker pdf_to_html (Docling export_to_html)
  → ~/.ax-studio/templates/<hash>/  (legacy)
  → %LOCALAPPDATA%/AXStudio/templates/<hash>/  (desktop)
       original.pdf | template.html | meta.json
  → ctx.variables.templateHtml (다음 html.render / pdf.generate 입력)
```

Dev CLI:

```bash
cd packages/document-engine
.venv/Scripts/python.exe scripts/pdf-to-html-test.py path/to/form.pdf --engine docling
```

### Write — report render

```text
ai_decision (report body)
  → modules/document/write/html  →  document-write/html/render
  → modules/document/write/pdf   →  document-write/pdf/generate  →  DesktopPrintBridge
  → generated/reports/<artifact-id>_<file-name> + metadata sidecar
  → safe `reportPdfArtifact` reference in runtime state
  → Slack/Gmail attachment (next delivery slice)
```

`document.pdf.generate` never places PDF bytes or a local storage path in
workflow variables, step results, checkpoints, or execution logs. The runtime
owns an artifact sink backed by `paths.generated.reports`; later delivery and
UI export use the artifact id through a host-owned read boundary.

### Write — source-authoritative PDF form

```text
document.pdf.form.analyze
  → document-engine pdf_form_analyze
  → template.json + original.pdf copy
  → reviewed field values
  → document.pdf.form.fill
  → document-engine pdf_form_fill → filled PDF artifact
```

The analyzer prefers native AcroForm widgets, then digital text/geometry, and
finally OCR/layout candidates. Each field includes its detected geometry,
provenance, confidence, and source hash; uncertain candidates require review
before they are used for a final export.

Form filling is source-authoritative: the Python worker uses PyMuPDF to update
native widgets or write an overlay onto a copied source PDF. It returns
`writerEngine: "pymupdf"` with `verified: true` only after reopening and
checking the saved output; it never overwrites the source. This is separate
from the PDF→HTML editing route, whose final output is produced by Chromium.

## Adding a write format

1. Implement pure logic in `document-write/<format>/`.
2. Add connector adapter in `modules/document/write/<format>/`.
3. Register the module in `modules/document/write/registry.ts`.

Path-based local file I/O: `modules/local-folder/`.
