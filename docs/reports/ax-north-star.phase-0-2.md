# North Star Phase 0–2 Report

Date: 2026-08-23

## Delivered

### Phase 0 — Platform contracts
- `packages/core/src/platform/*` — descriptors, lifecycle, knowledge types, sideEffect/mode policy, ToolInvoker, provider envelope
- Exported from `@ax-studio/core`
- 8 platform unit tests

### Phase 1 — Mode contract
- `interactionMode` on design-tool context (`plain_chat` | `authoring`)
- `isToolAllowedInMode` enforced in `executeDesignTool` and agent loop
- Interview IPC uses `authoring`; workspace chat uses `plain_chat` with `workflowActions`
- Workspace skill documents `workflows.list` / `workflows.run`

### Phase 2 — Saved workflow run from chat
- `workflows.list`, `workflows.run` design tools
- `runSavedWorkflowById` in `runtime/manual-workflow-run.ts`
- Desktop IPC wires list/run via store id validation

### Save disabled by default
- New `saveWorkflow` inserts `active = 0`
- Scheduler test enables workflow explicitly before once-trigger run

## Verification

- `npm test` — 363 passed (core)
- `npm run build` — core + desktop pass

## Key files

| Area | Path |
|------|------|
| Platform | `packages/core/src/platform/` |
| Mode policy | `packages/core/src/platform/mode-policy.ts` |
| Workflow tools | `packages/core/src/design-tools/tools/workflows-*.ts` |
| Manual run | `packages/core/src/runtime/manual-workflow-run.ts` |
| Store default | `packages/core/src/store/repositories/workflow-repository.ts` |

## Remaining (later phases)

- Explicit enable UX in desktop after `/workflow` save
- Agent loop unification (triple loops)
