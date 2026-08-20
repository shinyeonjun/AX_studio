# Document connector

Common abstraction for **reading** (Document Engine) and **generating** documents across formats.

## Layout

| Area | Status | Capabilities |
|------|--------|--------------|
| `engine/` | implemented | `document.ingest`, `document.getChunk`, `document.getPage`, `document.search` |
| `html/` | implemented | `document.html.render` — Handlebars → `ctx.variables.documentHtml` |
| `docx/` | implemented | `document.docx.fill` |
| `pdf/` | stub | `document.pdf.generate` — returns `{ html, needsDesktopPrint: true }`; desktop `printToPDF` not wired yet |
| `txt/` | planned | read, write |
| `markdown/` | planned | read, render |
| `google-drive/` | planned | read, export |
| `notion/` | planned | read, export |

## Data flow

### Read (PDF → text)

```text
trigger (local_folder / manual)
  → document.ingest (resolveDocumentIngestExecution)
  → Python worker (Docling | Basic)
  → DocumentArtifact (contracts/artifacts/document.ts)
  → ai_decision (summary)
  → slack.message.send | gmail.message.send
```

Ingest path resolution lives in one place: `contracts/document-ingest-resolve.ts`.

### Write (report → PDF) — planned

```text
ai_decision (report body)
  → document.html.render  →  ctx.variables.documentHtml
  → document.pdf.generate  →  { needsDesktopPrint: true }
  → desktop printToPDF IPC  →  FileRef (PDF bytes)
  → slack | gmail (attachment — not implemented)
```

## Document Engine

Ingest/read paths delegate to `packages/core/src/document-engine/` → Python sidecar at `packages/document-engine/`.

```text
document.ingest  →  StdioDocumentEngineClient  →  worker.py  →  Docling | Basic adapter
```

Setup: see `packages/document-engine/README.md` (venv + `pip install -r requirements.txt`).

Dev ingest (avoid PowerShell JSON encoding issues):

```bash
cd packages/document-engine
.venv/Scripts/python.exe scripts/ingest-test.py path/to/file.pdf --artifact-root ./out
```

## Adding a format (generation)

1. Create `format/action.ts` with the handler.
2. Export a `DocumentFormatModule` from `format/index.ts`.
3. Register the module in `registry.ts`.

Path-based local file I/O is handled by `modules/local-folder/`.
