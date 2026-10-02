# Restore preview history without replacing its evidence

**Status: retrospective record, pending independent ADR review.** This documents product code already written in `920aa0e8c84ba5dd09236cf1e7872bac1ad089b0`, based on `3dd272aaeffc5feb42ab63ce8507357f3baae965`. It is not prior approval. Product code is frozen at that checkpoint; the remaining proposals below are unimplemented and require review before further implementation.

## Problem and constraints

Preview `0ba5e22f54cc9fe2bb777f085290bb03de5f457b` persists v1 results in `executions.output_json` and an append-only `execution_log_entries` tail. After upgrade, the bytes survive but current projections hide them, and the old lazy result display is absent. Approval validation failures and rejection of unreadable history replace `log_json`; the retained preview checkpoint trigger then deletes the original tail.

The change must recover readable historical results without rewriting migrations/history, inventing successful evidence, weakening resume validation, loading all result bodies into app state, or redesigning the UI. Verification uses isolated synthetic profiles and both Windows native SQLite and sql.js, without live APIs, user data, installers or security bypasses. This follows [ADR 0001](0001-work-discovery-session-lifecycle.md)'s preference for reproducible evidence; it does not redefine all runtime writes as immutable.

## Alternatives and implemented decision

| Alternative | Benefit | Reason for the current choice |
| --- | --- | --- |
| No change | No added compatibility code | Leaves missing results/logs and destructive failure writes. |
| Restore only Store readers | Smallest read-layer patch | Does not restore the missing IPC/renderer result route or prevent failure writes deleting evidence. |
| Normalize legacy rows into current checkpoints | Simpler subsequent readers | Rewrites original bytes, can fire tail-deletion triggers, and cannot safely normalize unknown/malformed records. |
| Add a separate immutable evidence/diagnostic journal | Rich durable failure prose and independent audit history | Requires new storage/lifecycle contracts and migration work beyond this bounded compatibility fix. |
| Read-only compatibility plus existing lazy display and explicit preservation writes | Recovers results while keeping original evidence | Chosen narrow approach; retains the existing v1 and failure-state semantics. |

The implemented reader probes optional columns/tables, strictly decodes full stored JSON bytes, and validates the preview v1 output contract. Valid checkpoint entries precede tail entries ordered by sequence; repeated events and global sequence gaps remain meaningful. Invalid/unsupported history returns separate diagnostics and an explicitly raw/unavailable projection, never a fabricated normal log or a complete-looking partial prefix. Reads do not change execution or approval state.

Default lists carry result presence rather than bodies or result-length scans. The restored preview component requests output on demand through the existing trusted IPC wrapper. Output is limited to 262,144 UTF-16 code units, with a compatible 786,432-byte SQL guard; tail materialization uses a 10,000-entry/4 MiB stored-input budget. This does not bound existing checkpoint loading or aggregate-query scan cost.

Approval snapshot/log validation failures and rejection with log-source diagnostics opt into the existing `finishExecution` method's preservation mode. Only status, finish time and error code change; checkpoint/output/IR/tail bytes remain. Failed approvals remain closed, and invalid work is not resumed. New failure/rejection prose is returned and notified; persistent failure facts are metadata, not replacement historical log entries. Valid rejection and normal runtime checkpoint/deletion operations retain their existing behavior.

## Tradeoffs, expected effects and correctness criteria

- Preserved bytes do not establish success. Only successful executions with valid v1 output expose calculated results. Failed/cancelled/running/pending output remains stored but hidden; malformed or over-limit output remains diagnostic/error evidence. V1 extra-key projection follows the original validator contract.
- Migration, read and two-reopen tests must preserve payload HEX, tail sequence/order and read-only lifecycle state. Controls must retain chat, settings and pending approvals.
- Validation failure/rejection tests must preserve checkpoint/output/IR/tail HEX through two reopenings and repeated requests while recording the intended terminal state. No invalid action may execute. A limit violation must not resume a partial log.
- Default-list/lazy-query tests must prove no broadcast result bodies, no list result-length scans, and no log/IR/tail fetch by the output-only query. Unicode, NUL, BOM, invalid UTF-8, optional schema and SQLite error paths must retain their existing rejection/diagnostic behavior.

Recorded synthetic results at the product checkpoint: upgrade baseline 6 failures/4 passing controls; approval preservation baseline 14 failures; rejection baseline 10 failures/2 passing controls. After the fix, compatibility has 70 passing cases, new approval/rejection coverage has 26 passing cases, and focused suites pass 102/27 tests. Full core passes 2,268 tests with 4 skips; desktop passes 191. Core production/test and desktop types, core build and architecture checks pass. These are local Windows results, not independent reruns or combined c837/Product QA evidence. The independent code review reported no blocker; independent ADR review is still pending.

## Remaining proposals and unverified risks

1. **Display reason (P3, proposed).** `execution-state.ts:77–79` currently falls back to “unreadable log” after an invalid snapshot even when the preserved log is readable. Derive the accurate fallback reason from `errorCode` and add a regression with valid preserved log/invalid snapshot, asserting accurate state text and unchanged evidence. No display fix is implemented here, and no evidence should be rewritten to correct wording.
2. **Concurrent writers (assumption requiring review).** Tail COUNT/SUM and body SELECT are separate statements. The current size/merge guarantees assume stable legacy history and no concurrent external writer during a synchronous Store read. Multi-process/external-writer interleavings are untested. If that assumption is unacceptable, a consistent read snapshot or a bounded instability check plus a two-connection interleaving regression is proposed; no mitigation is implemented.
3. **c837 integration (proposed, unverified).** Its generation/admission lineage changes `workflow-store.ts` and approval snapshot validation and still routes failures through replacement writes. Retain its ownership checks/error-code expansion while reconciling preservation behavior, then test combined generation/admission and history invariants. Combined source behavior and packaging/runtime UI remain unverified. Existing blocked Windows packaging/UI QA and security restrictions remain in force.

## Rollout and rollback criteria

Keep the PR draft and product-code hold until independent ADR review returns. Parent owns subsequent integration and canonical sync. Before activation, review the writer assumption and disposition of the P3 display proposal, pass the invariants on the resulting branch, and coordinate authorized sandbox Product QA; this record does not clear the c837 packaging/UI blocker.

Any changed original bytes, falsely successful/partial evidence, invalid action execution, cap bypass or broken generation guard blocks rollout. At this source-only stage the preserved product checkpoint and regression fixtures permit review/revision without user-data changes. A later rollback must stop affected approval/rejection mutations and retain history unchanged before reverting or fixing forward: reverting to the old replacement-write path alone reintroduces evidence loss. The concrete containment mechanism is a remaining proposal to review before activation; no rollback flag, DB downgrade or history rewrite is implemented.
