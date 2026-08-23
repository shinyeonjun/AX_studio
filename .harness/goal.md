# Goal: Work Discovery Phases 0–8

Convert AX Studio workspace from NL-only workflow authoring to teach-by-example discovery:
past output → observe → inventory → synthesize/replay → clarify → compile → publish.

## Success criteria
- Phase 0: `ai_decision` explicit input bindings (tests pass)
- Phases 1–7: core `WorkDiscoveryService` pipeline with `discovery.*` commands
- Phase 8: Desktop teach-by-example UX (import artifact, poll inspect, review card, publish)
- `npm run build -w @ax-studio/core` passes
- `npm test -w @ax-studio/core` passes
- `npx tsc --noEmit -p apps/desktop/tsconfig.json` passes

## Non-goals
- Phases 9–10 (drift/repair)
- Full PDF parsing (text/CSV fixture path is sufficient for first slice)
