# Document connector

Common abstraction for **reading** (Document Engine) and **generating** documents across formats.

## Layout

| Area | Status | Capabilities |
|------|--------|--------------|
| `engine/` | implemented | `document.ingest`, `document.getChunk`, `document.getPage`, `document.search` |
| `html/` | implemented | `document.html.render` |
| `docx/` | implemented | `document.docx.fill` |
| `pdf/` | implemented | `document.pdf.generate` |
| `txt/` | planned | read, write |
| `markdown/` | planned | read, render |
| `google-drive/` | planned | read, export |
| `notion/` | planned | read, export |

## Document Engine

Ingest/read paths delegate to `packages/core/src/document-engine/` → Python sidecar at `packages/document-engine/`.

```text
document.ingest  →  StdioDocumentEngineClient  →  worker.py  →  Docling | Basic adapter
```

Setup: see `packages/document-engine/README.md` (venv + `pip install -r requirements.txt`).

## Adding a format (generation)

1. Create `format/action.ts` with the handler.
2. Export a `DocumentFormatModule` from `format/index.ts`.
3. Register the module in `registry.ts`.

Path-based local file I/O is handled by `modules/local-folder/`.
