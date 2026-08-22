# North Star Phase 8 Report — Authoring blocking questions

Date: 2026-08-23

## Delivered

- Chat asks **blocking** questions only: connections, contract/graph issues, recurring trigger, scope
- Param/goal/completion slots no longer interrogated in chat when graph is visible
- Save remains **disabled** (`active=false`) by default
- Sidebar **활성화/중지** toggle for explicit enable after save
- `/once` ephemeral execution snapshot unchanged (no saved workflow row)

## Verification

- `interview/test/session/messages.test.ts` updated for blocking-only chat policy

## Next

Phase 9 OpenAPI ingest
