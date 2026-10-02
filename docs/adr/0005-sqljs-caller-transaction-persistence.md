# Retain sql.js caller transaction ownership across persistence

**Status: independently approved design; implementation review remains required.** The parent relayed design-only approval of checkpoint `50de5337cac32286b396c8285f24ee46ef3d018e`, tree `3ef343234dc33b4e0a867359cfa82601c89992d0`, including 61 pinned-engine feasibility observations. Base `41cf05691e30677fda2148ef5b88e79f0fb957f3`. Implementation is authorized only within these decisions and their acceptance regressions. This decision is limited to sql.js persistence and its tests; it does not authorize publication, integration, main merge, UI/cancellation changes or canonical writes.

## Existing contract and reproduced gap

[ADR 0002](0002-preview-history-compatibility-and-evidence-preservation.md) already requires caller transactions and SAVEPOINTs to survive successful read snapshots. Its cleanup rules prohibit exporting an uncertain image and retain caller work until explicit disposal. Those preservation rules dictate fencing every sql.js export, rather than trusting the adapter's BEGIN-only counter.

The exact main adapter loses caller work outside the read callback. With synthetic rows 1 and 2 under `SAVEPOINT synthetic_caller`, a joined snapshot returns both. `persistNow()` returns success, but sql.js export closes/reopens the connection: row 2 disappears and `ROLLBACK TO synthetic_caller` reports no such savepoint. Disk bytes can remain identical, so a file-byte-only test misses the loss. Fourteen new local regressions produce twelve failures and two BEGIN timer/close controls on the unchanged adapter.

No production caller SAVEPOINT call site was found. Prepared transaction statements, compound control SQL, nested/duplicate names and ROLLBACK TO still make a hand-maintained counter insufficient. Neither sql.js exclusive-profile support nor SQLite isolation is expanded.

## Approved choices

1. **Explicit persistence barrier:** when any caller transaction is open, `persistNow()` throws `persistence_transaction_open` before export, file changes or pending-timer cancellation. This also replaces the old silent BEGIN no-op with an explicit failure. Caller rows and named SAVEPOINTs remain available for the caller to commit, release or roll back.
2. **Deferred persistence:** existing debounce/max-delay callbacks never export an open transaction. Persistence remains pending and retries at the existing 250 ms debounce cadence until caller ownership ends or explicit close cancels it. These retries are bounded to the adapter's existing timer slots; there is no forced commit, rollback, deadline extension of tests, or new worker. After the caller ends ownership, the existing persistence path exports committed state. This also handles ownership ending through prepared `all/get` controls without adding export hooks to reads.
3. **Explicit close:** preserve the existing BEGIN close policy, which explicitly discards uncommitted caller work. Extend the same policy to actual SAVEPOINT ownership: cancel timers, roll back the open transaction before exporting committed state, then close. A failed rollback/export retains the primary error, closes without an unsafe export and leaves the prior file unchanged. Close is disposal; it does not acknowledge uncommitted work as durable.
4. **Ownership detection:** use SQLite state through an adapter-owned raw `BEGIN DEFERRED` probe at persistence/close boundaries. SQLite's exact `cannot start a transaction within a transaction` rejection identifies existing caller ownership without modifying it. A successful BEGIN proves the probe owns the otherwise idle transaction; roll back only that newly acquired probe. This avoids parsing control SQL or changing the sql.js dependency/build.
5. **Uncertain detection:** unexpected BEGIN or probe-ROLLBACK errors preserve the original exception and fail the adapter closed with a separate persistence-ownership diagnostic. Cancel pending timers, reject further normal queries/writes/exports, and allow explicit disposal without export or a caller-wide rollback. This follows ADR 0002's existing uncertain-cleanup containment, with an accurate diagnostic for the new boundary.

The BEGIN/ROLLBACK probe must not run inside the read callback or use generic adapter `exec`, which schedules persistence. It must retain query_only/foreign_keys settings, caller writes and SAVEPOINT state. Successful read snapshots keep their existing savepoint/query_only behavior.

The implementation removes the BEGIN counter entirely. Generic exec/run records pending persistence while caller ownership is open; no export hook is added to reads. At most the existing debounce and maximum-delay timer slots remain active. The maximum-delay callback is subject to ownership fencing and cannot guarantee a one-second flush during an indefinitely open caller transaction. Prepared all/get completion can end ownership without scheduling another write; retained callbacks then persist the completed state.

Uncertain engine probes report `persistence_transaction_state_unknown` on later access. Failed post-export connection restoration reports `persistence_connection_restore_failed`; unsuccessful disposal reports `persistence_close_failed` unless an earlier containment reason already applies. Original exceptions take precedence over subsequent restoration/disposal errors. A recoverable export error with successful restoration permits an explicit retry. These diagnostics do not turn disposal into acknowledgement of uncommitted work.

Startup cleanup also retains the original initialization/persistence exception when disposal fails. It cancels an attached adapter's timers and discards the image without exporting it. Started exec/run operations queue persistence even when SQLite throws: a compound batch or conflict FAIL can retain successful effects. Scheduling failures cannot replace a prior SQL exception; the existing engine fence still postpones export while a caller owns a transaction. These corrections implement the approved pending-work/error-precedence policy without changing the ownership, disposal or isolation decisions.

## Alternatives

| Approach | Why not selected |
| --- | --- |
| Add SAVEPOINT names/depth to SQL text bookkeeping | Requires reproducing SQLite grammar, compound/prepared control execution, duplicate-name release semantics and implicit rollback after SQL errors; another missed case can silently destroy work. |
| Depend on sqlite3_get_autocommit | The installed sql.js 1.14.2 public Database API does not expose it. A custom WASM export or unsupported private pointer API is a broader dependency choice. |
| Always reject file-backed persistence after any caller SAVEPOINT | Permanently disables valid committed persistence and cannot identify ownership ending. |
| Export and compare/restabilize afterward | Export has already discarded caller state; rollback is then impossible. |
| Engine ownership probe and fail-before-export | Uses SQLite's actual transaction state and preserves the current dependency and supported caller SQL. |

## Required evidence and limits

Use exclusively owned synthetic SQLite files/profiles, allowlisted process environments and a no-network guard. Preserve the original red probe and reports.

Regressions cover explicit BEGIN and SAVEPOINT barriers after nested read snapshots; commented/quoted control SQL and prepared run/all/get; compound control statements; nested/duplicate SAVEPOINTs; ROLLBACK TO versus full ROLLBACK; RELEASE/END/COMMIT; failed controls and deferred-foreign-key commit failure; both pending-timer deadlines and later persistence; explicit-close rollback-before-export; uncertain probe acquisition/cleanup with primary-exception and unchanged-file assertions. Existing native/sql.js snapshot guards, history compatibility/reopen cases, relevant units, source/test types, compilation and architecture must pass on an immutable candidate.

The engine probe preserves idle database rows/settings but briefly opens and rolls back its own transaction. Actual caller state must not be finalized or altered. Writable sql.js still requires exclusive profile ownership and reflects only its loaded image. This decision makes no UI, runtime recovery, multi-process locking, installed-app, packaging or release acceptance claim.
