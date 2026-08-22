# North Star Phase 6 Report — Local retrieval index

Date: 2026-08-23

## Delivered

### Local keyword index (no cloud embeddings)
- `packages/core/src/retrieval/` — in-memory index per connected folder
- `IndexDocument` rows with `indexedAt` / `staleAfter` from file mtime
- Indexes text-like files (`.txt`, `.md`, `.json`, …) at or above `minFileBytes` (default 16KB)
- Simple token scoring; no external embedding API

### ACL, stale, data policy
- Only files within `resolveFolderRoot` are indexed and searchable
- Deleted or changed files are tombstoned and excluded from later hits
- `sources.search` applies cloud snippet cap (`240` chars) unless `allowUntrustedData`
- `sources.file.read` returns a `citation` on successful bounded read

### Plain-chat surface
- Design tool **`sources.search`** — `{ query, folderId?, limit? }`
- When `retrievalIndex.enabled` is false on the local_folder connection, returns `fallback: sources.files.list`
- Enabled via connection config: `{ retrievalIndex: { enabled: true, minFileBytes?: number } }`

## Verification

- `retrieval/retrieval.test.ts` — ACL ranking, stale tombstone, cloud snippet cap, search on/off
- Full core suite + `npm run build` (run after merge)

## Key files

| Area | Path |
|------|------|
| Index + search | `packages/core/src/retrieval/` |
| Design tool | `packages/core/src/design-tools/tools/sources-search.ts` |
| Config | `packages/core/src/retrieval/config.ts` |
| Citations on read | `packages/core/src/design-tools/tools/sources-file-read.ts` |

## Next (Phase 7)

- Approval gates per work (`EXTERNAL` default, `EXTERNAL_HIGH` always gated)
