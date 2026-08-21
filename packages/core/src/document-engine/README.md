# Document Read Engine (TS client)

Node/Electron client for the Python read sidecar at `packages/document-engine/`.

## Layout

| Path | Role |
|------|------|
| `engine-client.ts` | Stdio IPC — ingest, getChunk, getPage, search |
| `types.ts` | Ingest result types |
| `paths.ts` | Artifact path helpers |

Workflow adapters: `modules/document/read/` (params resolution, `ctx.variables`).

Write/generation: `document-write/` (separate engine).

Setup: `packages/document-engine/README.md`.
