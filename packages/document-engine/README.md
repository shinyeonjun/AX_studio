# Document Engine (Python sidecar)

Python worker for document ingest, parsing, and artifact storage. Node/Electron talks to it via **stdin/stdout JSON** (one request per process spawn).

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
~/.ax-studio/documents/<hash>/manifest.json
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
| `AX_DOCUMENT_ENGINE_PYTHON` | Python executable |
| `AX_DOCUMENT_ENGINE_WORKER` | Path to `worker.py` |
| `AX_DOCUMENT_ARTIFACT_ROOT` | Artifact directory (default `~/.ax-studio/documents`) |

## Manual smoke test

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

## Commands

| command | params |
|---------|--------|
| `ping` | — |
| `ingest` | `path`, `artifactRoot`, `options.engine`, `options.ocr` |
| `get_chunk` | `documentId`, `chunkId`, `artifactRoot` |
| `get_page` | `documentId`, `pageIndex`, `artifactRoot` |
| `search` | `documentId`, `query`, `artifactRoot` |

## Production note

venv is for **development**. Shipping the desktop app will bundle a frozen Python runtime + deps (or download on first use). See root README / future packaging task.
