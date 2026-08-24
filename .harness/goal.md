# Goal: Work Discovery correctness-first completion

Complete Work Discovery so teach-by-example flows are verified end-to-end:
historical output + optional input → observe → source inventory → synthesize/replay → clarify → compile → publish → runtime execution.

## Success criteria
- North-star E2E passes (`packages/core/src/work-discovery/e2e/work-discovery-e2e.test.ts`)
- `compileBlueprintToWorkflow` preserves `fields[].mapping` via `transform.evaluate`
- ALL-pass multi-example replay; truncated aggregate rejection
- Required observation publish gate; scoped clarification
- `inputArtifactIds` consumed via `DiscoverySourceProvider` registry
- `npm run build -w @ax-studio/core` passes
- `npm test -w @ax-studio/core` passes (359+ tests)
- `npm run eval -w @ax-studio/core` passes
- `npx tsc --noEmit -p apps/desktop/tsconfig.json` passes
- `npm run build -w @ax-studio/desktop` passes
- document-engine pytest passes

## Current task: session-scoped document sources

Implement the session context boundary for uploaded documents. A workspace chat
owns source references; the artifact store owns immutable input files and
Docling ingest results; the agent receives only bounded source metadata and can
read a ready source through a host command using its session/source id.

### Success criteria

- A workspace chat can attach a local PDF without putting the binary or an absolute path in the transcript.
- The source is persisted under the chat session with an id, status, artifact reference, and Docling summary.
- Existing PDF imports used by Work Discovery continue to ingest through the configured document engine.
- The agent command context contains the current session's source manifest and can read a ready source through a bounded session-source command.
- A source from one chat cannot be read through another chat's session id.
- A failed ingest is persisted as a structured source failure instead of being reported as ready.
- Core tests and desktop typecheck/build pass; no external connector side effects are used by tests.

### Non-goals for this slice

- Promoting a session source into a recurring workflow binding.
- Full source-panel visual redesign; this slice only adds the minimal 자료/흐름 context toggle.
- Background job durability across process crashes; the first slice keeps ingest host-owned and status-persisted.
- General Gmail/Slack artifact ingestion.

### Final checkpoint (2026-08-24)

- Session source repository/service, Docling artifact manifest, bounded agent commands, Electron IPC/preload, and the right-side 자료 panel are implemented.
- Verified with core 88 files/365 tests, targeted session-source tests 5 files/16 tests, core eval 11/11, document-engine 17 tests with 2 pypdf skips, core/desktop typecheck, production build, and diff check.
- Added a host-side guard that prevents chat submission while a session PDF is still being ingested; the latest desktop typecheck and production build pass.

## Non-goals
- Schema drift auto-repair (fixture only)
- Agent semantic synthesis harness (deferred; deterministic path first)
- Phases 9–10 drift/repair productization
