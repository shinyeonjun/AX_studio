# Registered HTTP metadata: local implementation checkpoint

This implements the independently accepted revision-2 ADR as a default-off offline slice. The complete ADR and frozen evaluation plan were committed first at `3368680ad18d25315365b31de56a0c513e2d899b`. The isolated branch is `feat/registered-http-metadata-offline`, based on main `c42548ca0cc572b9eaeb7e0eaf035689f62a5e18`. No other worker's commits have been imported and no branch publication is authorized by this checkpoint.

The implementation uses real saved HTTP registrations and field dictionaries, private revision-bound single-use permits, the existing finite Jev evaluator, exact persisted turn IDs, and a main-process generation owner. Main appends metadata replies synchronously against the current transcript and returns an identity-checked receipt; the renderer reloads that transcript instead of replacing it with an old snapshot. Every whole-transcript writer of a participating session compares a captured revision. Background execution-result appends advance the same revision. A host-authored message marker restores CAS participation after restart, while process-scoped tokens and ephemeral permits are discarded. Renderer flags cannot mint membership or remove host-marked anchors; session deletion remains the removal boundary.

Saved operation references pass a bounded syntax gate before their labels or paths are projected. Unsafe credential/query/fragment/encoded references are dropped as whole entries. Exact accepted paths are retained, with explicit local, filtered and truncated coverage. The local adapter runs before the normal command gateway. Missing metadata, uncertain decisions, retrieval/actions and unsupported adapter kinds terminate without a connector, body read, enqueue or prose fallback. Authentication, remote permission and health remain unknown.

## Change map for independent review

| Area | Files and purpose |
| --- | --- |
| Local metadata producer | New Core `service/registered-http-metadata.ts` and focused tests; evidence contract and deterministic metadata output extensions; service dispatch and private session permit claims |
| Source revisions | `persistence/workflow-store.ts` supplies actual connection/dictionary counters; successful dictionary mutations advance the counter; `settings-repository.ts` suppresses raw corrupt-config diagnostics only for this adapter |
| Transcript fence | Workspace-chat contracts, queries, mutations and repository exports; new shared DB revision owner and restart tests; trusted job-registration mapping writes supply their current revision |
| Desktop lifecycle | New `ipc/workspace-chat-command-handlers/metadata-turns.ts`; persistence admission, exact chat-boundary turn selection, chat handler and existing request/session/shutdown registry hooks |
| Renderer/API | Optional preload/API save preferences and receipt; message actions capture revisions across awaits; load/lifecycle/context files carry authoritative revisions and preserve unsaved conflict text for review |
| Evidence | New real store/service/trusted-IPC test with 13 frozen rows; three added races in existing `useDiscovery.test.ts`; separate Core adapter/restart tests; ADR, evaluation plan, results and this checkpoint |

The shared-interface map was communicated before those edits. Task-5 UI checkpoint `c672e2ee26c105ed2ef287a97c6cb7b98cb4e592` and Core `19cfbda` remain separate; combining them requires parent review of the exact resulting tree, particularly transcript deletion, draft recovery and confirmation behavior. This branch does not change the result pane or add a metadata mode selector.

## Offline evidence

The current source passes 13/13 real trusted-IPC rows, 564 affected Core tests in 71 files, and 55 affected Desktop tests in 8 files. Each row requires positive facts or a specific necessary clarification. Its transport counts include every fixture variant and reconcile to 40 scripted fetches and 112,613 request bytes, including aborted and failed batches. Forbidden calls and live provider calls are both zero. These scripts validate host integration; Korean model quality, calibration, live latency, token usage and cost are not measured.

The original 24-case gate is unchanged at Git blob `025bfcac02a18bdef40e3b1c9d0dbae869510d4a`. Its Git bytes SHA-256 is `e3581b246342189a4d670281b20af4bb6a8e889c44bca133fe85ce3794627dc3`; Windows checkout CRLF bytes hash to `1357d82a9f340c75dc80c9caf8ab60eeb4f71ce051caaa86b01fb5198a74e9f3`. This is a line-ending difference only, with the reviewed fixture content and Git identity preserved.

Final exact-commit verification reruns that 24-case gate, the affected suites, Core production/test and Desktop typechecks, Core TypeScript emit, Desktop production build, architecture and the eight preserved dependency/webhook security tests. Machine-readable results live under `build-evidence/registered-http-metadata`, with the immutable commit/tree, commands, exit codes, report hashes and patch identity saved task-locally under `review-patches` for parent review. The checked-in [results](registered-http-metadata-results.json) summarize the assertions; that external manifest identifies the exact commit without requiring a self-referential commit hash in this file.

Existing installed dependency directories were reused through task-local junctions, with a new `@ax-studio/core` link to this checkout's freshly emitted Core output. No packages were installed. Desktop compilation needed an approved sandbox directory-read retry; build outputs remained task-local, OAuth build values were cleared, and no app or installer was launched. No canonical checkout, real database, email, private screenshot or credential was inspected or changed.

## Limits and remaining permission

The installer for this lane is an internal `offline_test` function requiring an injected fetch. It has no startup, environment-only or shipped UI activation callsite. Ordinary requests retain the existing route; participating sessions intentionally gain stale-transcript rejection. Older transcripts remain readable. The broader read controller remains unwired. Desktop correction fragments start fresh and can clarify; partial inheritance and full correction UX are deferred. Only local saved HTTP facts are supported, and cross-process database writers are outside this single-main-store slice.

Parent exact-code review remains required before any push or combined UI integration. The one future question/context-package contrast remains preregistered under identical safety/candidates/output. Any live study requires separate authorization with a fresh actual-dispatch/token/cost cap. The existing live ledger remains **27/30 unchanged**.
