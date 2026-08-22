# North Star Phase 7 Report — Approval gates per work

Date: 2026-08-23

## Delivered

- `allowExternalAuto` default **false** — EXTERNAL actions require approval unless relaxed per work
- `EXTERNAL_HIGH` always requires approval (cannot relax)
- Approval uses capability `sideEffect` via `resolveEffectiveSideEffect` (HTTP method is ingest default only)
- `summarizeApprovalGates()` for review UI
- Workspace review card shows gate summary + EXTERNAL auto-run toggle
- Plain-chat `workflows.run` uses the same runtime approval path

## Verification

- `workflow/approval.test.ts` — default gate, relaxation, HIGH immutability, HTTP catalog override

## Next

Phase 8 blocking authoring UX
