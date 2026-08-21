# Nodes (workflow primitives)

앱 **모듈**(`modules/`)과 별도. Agent가 자연어에서 끼워 넣는 **워크플로우 기본 노드** 구현 위치.

## Layout (target)

| Area | Path | Role |
|------|------|------|
| Data | `nodes/data/` | ref pick, field-map |
| Transform | `nodes/transform/` | contract adapters |
| Flow | `nodes/flow/` | if, join, branch |
| State | `nodes/state/` | storage get/set |

## Module vs trigger vs catalog

| Layer | Path | Example |
|-------|------|---------|
| Contract | `contracts/` | `FileRef`, `DocumentArtifact` |
| Catalog | `catalog/` | `document.ingest`, `local_folder.new_file` |
| Module | `modules/` | `modules/gmail/`, `modules/document/` |
| Trigger transport | `triggers/` | `triggers/gmail/new-message/` |

## Implementation status

| Capability | Status | Module |
|------------|--------|--------|
| Gmail Read/Search | ● | `modules/gmail/` |
| DB Schema / Query | ● | `modules/rdb/` |
| Local Folder | ● | `modules/local-folder/` |
| Document read (ingest) | ● | `document-engine/` + `modules/document/read/` |
| File Read (generic) | ○ | future connector; no runtime implementation |
| Document write (HTML/PDF/DOCX) | ● stub | `document-write/` + `modules/document/write/` |
| Storage Get/Set | ○ | future node; no runtime implementation |
| Gmail/Slack send | ● | `modules/gmail/`, `modules/slack/` |
| Google Calendar/Drive/Sheets | ○ | future connectors; no runtime implementation |
| HTTP GET/POST | ○ | future connector; no runtime implementation |

## Triggers

| Trigger | Status | Path |
|---------|--------|------|
| Gmail New Message | ● | `triggers/gmail/new-message/` |
| Slack New Message | ● | `triggers/slack/new-message/` |
| Local Folder New File | ● | `triggers/local-folder/new-file/` |
| Webhook | ○ | future transport; no runtime implementation |

## Adding a new module

1. `catalog/capabilities.ts` — capability ids + params
2. `catalog/connectors.ts` — connectable metadata (if OAuth/builtin)
3. `modules/<id>/` — connector + optional `triggers/`
4. `modules/register-defaults.ts` — runtime registration via `registerModule()`
5. `modules/mocks/` — dev/test mock
6. `contracts/` — input/output artifact types when wiring data flow

See `STRUCTURE.md` at package root for full layout.
