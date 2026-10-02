# Restore preview history without replacing its evidence

**Status: approved for the specified snapshot and terminal-reason implementation.** On 2026-10-02 the parent relayed independent review acceptance of ADR commit `876ed0517c65a9dbdcc3aee05eb460456097a66a`. This lifts the product-code hold only for these commitments and their stipulated regressions; it authorizes neither merge nor activation. The retrospective record covers `920aa0e8c84ba5dd09236cf1e7872bac1ad089b0`, based on `3dd272aaeffc5feb42ab63ce8507357f3baae965`, and is not prior approval of that code. The resulting implementation still requires exact-commit independent review and reruns.

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

The implemented reader probes optional schema, decodes full stored JSON bytes and validates preview v1 output. Checkpoint precedes sequence-ordered tail, retaining duplicates and global gaps. Invalid/unsupported history yields separate diagnostics and a raw/unavailable projection, never fabricated normal events or a complete-looking partial prefix. Reads do not change lifecycle state.

Default lists carry presence without result bodies/length scans; the preview component uses on-demand trusted IPC. Output caps are 262,144 UTF-16 units/786,432 SQL bytes; tail materialization has a 10,000-entry/4 MiB stored-input budget. Checkpoint loading and aggregate scan cost remain unbounded by these caps.

Approval snapshot/log validation failures and rejection with log-source diagnostics opt into `finishExecution` preservation mode. Only status, finish time and error code change; checkpoint/output/IR/tail bytes remain. Invalid work does not resume. Failure/rejection prose is returned/notified; metadata persists the failure. Valid rejection and normal checkpoint/deletion behavior remain unchanged.

## Tradeoffs, expected effects and correctness criteria

- Preserved bytes do not establish success. Only successful executions with valid v1 output expose calculated results. Failed/cancelled/running/pending output remains stored but hidden; malformed or over-limit output remains diagnostic/error evidence. V1 extra-key projection follows the original validator contract.
- Migration, read and two-reopen tests must preserve payload HEX, tail sequence/order and read-only lifecycle state. Controls must retain chat, settings and pending approvals.
- Validation failure/rejection tests must preserve checkpoint/output/IR/tail HEX through two reopenings and repeated requests while recording the intended terminal state. No invalid action may execute. A limit violation must not resume a partial log.
- Default-list/lazy-query tests must prove no broadcast result bodies, no list result-length scans, and no log/IR/tail fetch by the output-only query. Unicode, NUL, BOM, invalid UTF-8, optional schema and SQLite error paths must retain their existing rejection/diagnostic behavior.

Recorded Windows native/sql.js results: upgrade baseline 6 failures/4 controls; approval preservation 14 failures; rejection 10 failures/2 controls. After fixing: 70 compatibility and 26 new approval/rejection cases pass; full core 2,268 pass/4 skip, desktop 191 pass. Types, core build and architecture pass. These are not independent reruns or combined c837/Product QA evidence. Code review reported no blocker; the later ADR acceptance does not approve an unreviewed resulting implementation.

## Accepted implementation commitments

### One snapshot for the execution and its tail

The pre-acceptance reader selected execution state/checkpoint and tail COUNT/SUM/body in separate statements without an encompassing transaction. **Use a consistent SQLite read snapshot**, rather than an implicit stable-writer assumption or rechecking aggregate totals. Equal counts and lengths cannot prove row/byte identity; replacements can retain both.

A backend-owned synchronous read snapshot starts before schema/execution selection. Native SQLite owns `BEGIN DEFERRED` unless already in a caller transaction; the first database read establishes the snapshot. Schema, execution status/checkpoint/output presence, tail COUNT/SUM and ordered body SELECT share it. Lists cover all selected executions/tails in one snapshot. Apply current budgets before fetching bodies and validate all entries. Join caller transactions without finalizing them; finalize/rollback only owned transactions, including error cleanup. No callback writes or weakened isolation. WAL pages can remain pinned until release. This guarantees coherent projections, not later approval-write ownership. [SQLite transactions](https://www.sqlite.org/lang_transaction.html), [snapshot isolation](https://www.sqlite.org/isolation.html).

sql.js loads an independent image, misses external file commits and can overwrite them on export. Its snapshot covers that image only. Generic transaction-control `exec`/close can persist; `readSnapshot` uses raw savepoint control without those persistence hooks, temporarily enables `query_only`, and restores its prior value. It retains caller transactions, savepoints and persistence timers. Callback writes, transaction control and close are rejected; sql.js snapshot queries are restricted to SELECT/WITH/EXPLAIN and the reader's table-info pragma. Tests assert no read-triggered export. Writable sql.js requires exclusive profile ownership/no external writer; if unassured, keep it inactive. This is a support/deployment constraint, not a claim that the adapter detects external writers. Native multi-connection results establish neither sql.js file locking nor cross-process writer support.

Implemented deterministic regressions in [execution snapshots](../../packages/core/src/persistence/repositories/execution-snapshot.test.ts) and [backend ownership](../../packages/core/src/persistence/db/read-snapshot.test.ts), with synthetic files only and barriers rather than sleeps:

- Two native WAL connections: append after execution selection and after COUNT/SUM, including count/byte boundary crossings. The reader returns its original complete snapshot; the next snapshot sees the append or limit diagnostic.
- Update status/checkpoint and trigger tail deletion between those reads. Return old execution plus old tail, never a mixture; the next snapshot sees the new state.
- Equal-count/equal-length replacements must not defeat identity coherence. Test owned-transaction cleanup, caller-transaction retention, zero reader writes and bounded bodies.
- sql.js: test loaded-image coherence, no read-triggered export and fresh import against a controlled writer using a read-only image. These are not two live connections; never persist a stale writable image over that writer. Writable-profile tests stay exclusively owned.

### Current terminal reason precedes historical error prose

Previously `execution-state.ts` mislabeled invalid snapshots as unreadable logs. For preserved snapshot/log failures, terminal `errorCode` (`invalid_execution_snapshot`/`invalid_execution_log`) now takes precedence over older error prose when status is failed. The message describes failed resume validation, not current unreadability; historical messages remain without rewriting. [Resume-failure state regressions](../../apps/desktop/electron/main/ipc/state-handlers/preview-resume-failure.test.ts) use readable logs with no error and with an older error, including actual invalid-snapshot continuation. They assert current reason, terminal status, unchanged payload/tail HEX and two reopens. Nonterminal controls retain historical error presentation. Additional c837 failure codes need separate review.

### c837 remains separately gated

Its Store/snapshot lineage still uses replacement failure writes. Retain ownership checks/error-code expansion and independently review/test the exact combined commit's generation/admission/history behavior. Combined source and packaging/runtime UI are unverified; existing Windows QA/security blocks remain. No new blocking defect was established in reviewed code. ADR acceptance does not authorize this integration.

### Post-acceptance local verification

Before the snapshot implementation, its new core regressions produced 22 failures/2 controls; terminal-reason regressions produced 12 failures. After implementation, the focused core set passes all 111 tests and the desktop set passes all 27. Two further nonterminal controls pass in the complete desktop suite. Full core units pass 2,299/4 skip (460 files; live API/eval exclusions); desktop product units pass 205 (47 files). Core production/test and desktop types, core build and architecture pass (1,302 modules/4,822 dependencies). All files/profiles are synthetic and exclusively owned except the stipulated native two-connection and read-only sql.js image tests. These are local author checks, not independent exact-commit review, CI or combined runtime/UI approval.

## Rollout and rollback criteria

1. Keep the PR draft. Independent ADR acceptance has lifted only the snapshot/terminal-reason implementation hold; it authorizes neither merge nor activation.
2. Record the resulting product commit, independently review it and rerun these regressions, native/sql.js compatibility, full units, types/build and architecture on it. `920aa0e` results do not approve later code. Parent owns merge/canonical decisions; c837 combination and authorized Product QA/packaging stay separately gated with existing blockers.
3. Any changed original bytes, mixed/partial or falsely successful evidence, invalid action execution, cap bypass or broken generation guard blocks rollout.

**Rollback containment (not executed):** prevent relaunch and stop **all** affected app/Electron, runtime, CLI/service and worker processes before rollback deployment. Verify exit/no active DB handles or persistence owners; without quiescence, do not replace/restart. Global execution off is insufficient: rejection writes and sql.js persistence remain possible.

Retain DB/sidecars unchanged through build rollback: no downgrade, normalization, old-snapshot restore or sidecar deletion. Restart only an exact independently reviewed preservation-safe build with passing preservation regressions; the old replacement-write build is unsafe. Without a safe build, keep processes stopped and seek reviewed fix forward. This documentation executes no process stop, deployment or DB operation.
