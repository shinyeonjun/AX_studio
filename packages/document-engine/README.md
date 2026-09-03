# Document Engine (Python sidecar)

Python worker for document ingest, parsing, source-authoritative PDF form analysis, and PDF form export. Node/Electron talks to it via **stdin/stdout JSON** (one request per process spawn).

Document **generation** (HTML/PDF/DOCX write) lives in `packages/core/src/document-write/` — not in this package.

Write-side PDF→HTML template import also uses this worker (`pdf_to_html` command). PDF form export writes onto a copy of the original PDF, keeping the original as the visual authority.

## Architecture

```text
Workflow (Node/TS)
      ↓ document.ingest
DocumentEngineClient (stdio IPC)
      ↓
worker.py
      ↓
Parser Adapter
  ├─ DoclingAdapter   (optional, requirements-docling.txt)
  └─ BasicAdapter     (pypdf + text, default fallback)
      ↓
~/.ax-studio/documents/<hash>/manifest.json   (legacy)
%LOCALAPPDATA%/AXStudio/documents/<hash>/     (desktop default)
```

Docling types stay inside the Python adapter. Node only sees AX-owned summaries and artifact paths.

## Dev setup (venv)

```powershell
cd packages/document-engine
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
# optional full pipeline:
# pip install -r requirements-docling.txt
```

Unix:

```bash
cd packages/document-engine
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Core auto-detects `packages/document-engine/.venv` when spawning the worker.

Override paths with env vars:

| Variable | Purpose |
|----------|---------|
| `AX_DATA_ROOT` | AX Studio data root (desktop sets this) |
| `AX_DOCUMENT_ARTIFACT_ROOT` | Override documents directory |
| `AX_TEMPLATE_ROOT` | Override templates directory |
| `AX_DOCUMENT_ENGINE_PYTHON` | Python executable |
| `AX_DOCUMENT_ENGINE_WORKER` | Path to `worker.py` |

## Manual smoke test

Prefer the CLI wrapper on Windows (avoids PowerShell stdout encoding issues):

```powershell
cd packages/document-engine
.\.venv\Scripts\python.exe scripts/ingest-test.py C:\path\to\file.pdf --artifact-root .\out --engine docling --ocr auto
```

Raw worker (Linux/macOS or piping via Python subprocess):

```powershell
$req = '{"id":"1","command":"ping","params":{}}'
$req | python packages/document-engine/src/worker.py
```

Ingest:

```powershell
$req = '{"id":"2","command":"ingest","params":{"path":"C:/path/to/file.pdf","artifactRoot":"./.ax-studio/documents","options":{"engine":"basic"}}}'
$req | python packages/document-engine/src/worker.py
```

## Artifact layout

```text
.ax-studio/documents/
  <hash-prefix>/
    <document-id>/
      manifest.json
      chunks.jsonl
      pages/
      images/
      tables/
```

Node receives only `{ documentId, artifactPath, summary }` from ingest — not full page text on stdout.

## PDF engine boundaries

The PDF paths deliberately use different engines for different jobs:

- **Read and semantic structure:** `document.ingest` resolves the Docling
  adapter in `auto`/`docling` mode, with the Basic adapter available as the
  explicit or automatic fallback when Docling is unavailable or fails.
- **Form geometry:** `pdf_form_analyze` uses native AcroForm metadata first,
  then PDF text/vector geometry, then OCR/layout candidates. This geometry
  path is separate from semantic Docling extraction because a form writer
  must know the exact page and field rectangle.
- **Canonical form write:** `pdf_form_fill` uses PyMuPDF to update native
  widgets or draw values on a copy of the source PDF. The response identifies
  `writerEngine: "pymupdf"` and returns `verified: true` only after reopening
  the temporary output and checking page geometry plus requested field values.
  Text overlays validate the selected font's glyph coverage and use an
  embedded PyMuPDF CJK fallback when no configured system font covers the
  value; missing or partial explicit fonts fail instead of falling back to an
  ASCII-only font. Native text and choice fields are verified against the
  reopened rendered text as well as their logical widget values. A source hash
  check prevents writing over a changed source or the source file itself.
- **PDF → HTML editing:** `pdf_to_html` remains the editable preview route;
  it is not used as the canonical form export. HTML is printed through the
  Chromium path when an HTML workflow is explicitly requested.

## Commands

| command | params |
|---------|--------|
| `ping` | — |
| `ingest` | `path`, `artifactRoot`, `options.engine`, `options.ocr` |
| `get_chunk` | `documentId`, `chunkId`, `artifactRoot` |
| `get_page` | `documentId`, `pageIndex`, `artifactRoot` |
| `search` | `documentId`, `query`, `artifactRoot` |
| `pdf_to_html` | `path`, `templateRoot`, `options` |
| `pdf_form_analyze` | `path`, `templateRoot`, `options.ocr`, optional `options.fieldHints` |
| `pdf_form_fill` | `path`, `template` or `templatePath`, `values`, optional `outputPath`, `fontPath` |

## PDF form workflow

```text
original.pdf
  → pdf_form_analyze
      → AcroForm widgets, digital text/geometry, or OCR/layout candidates
      → template.json + immutable original.pdf copy
  → review field geometry and confidence
  → pdf_form_fill(values)
      → filled.pdf (interactive when the source has AcroForm widgets)
```

The template contract records page geometry, field provenance, confidence, and
source hash. Low-confidence OCR/layout candidates remain reviewable instead of
being treated as trusted field mappings. Filling rejects a changed source and
never overwrites the source PDF.

## Production note

venv is for **development**. Shipping the desktop app will bundle a frozen Python runtime + deps (or download on first use). See root README / future packaging task.
