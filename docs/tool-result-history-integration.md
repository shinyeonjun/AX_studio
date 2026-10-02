# Editable results, preview history and committed persistence

This integration composes the existing Gmail/Slack editable-result UI, read-only
database result pane, preview-history readers, diagnosed cancellation recovery and
sql.js transaction-ownership correction. The UI continues to use the existing
Electron main/preload/runtime and real connector contracts.

## Result and approval contracts

Known proposal fields arrive filled and remain editable. Missing essentials allow
initial writing and contextual correction. Review resolves the connected sender
and exact destination and shows the complete literal payload. Only explicit
confirmation of a current host seal may send. Edits, back navigation, tool/context
changes, connection revisions and stale asynchronous results invalidate review.
Renderer locks and a durable conditional host claim protect repeated confirmation.
Cancellation is terminal; receipts and unknown outcomes provide no resend action.

Database results retain read-only opening, verified query-only state and curated
query guards. Available execution-owned provenance, bounded rows and collapsed
details remain separate from unavailable labels, SQL or global totals. No new
provider permission, credential, OAuth grant or external database write is added.
See [UI contracts](tool-result-ui-contracts.md) and
[ADR0004](adr/0004-tool-specific-editable-results.md).

## History and durability composition

Synchronous read snapshots retain their ownership/query guards. Side-effect
claims, receipts and terminal cancellation cross the committed-write barrier
before acknowledgement. Native SQLite retains its reviewed snapshot and FULL
synchronous behavior. sql.js retains synchronized temporary-file writes and
atomic replacement plus the verified read-only opener.

When cancellation has log-source diagnostics, both direct rejection and startup
recovery select the existing history-preserving completion option. Terminal
metadata becomes durable without replacing checkpoint, output, IR or raw tail.
Valid rejection keeps ordinary checkpoint replacement and tail consumption.
Recovery performs no provider dispatch, identity lookup or seal restoration.
These are the existing
[ADR0002](adr/0002-preview-history-compatibility-and-evidence-preservation.md) and
ADR0004 contracts; the bounded recovery correction is described
[separately](tool-result-cancellation-recovery-fix.md).

sql.js now determines ownership from the actual SQLite engine at export/close
boundaries. The only overlapping production merge uses `flushPersist(true)` and
retains the UI's file synchronization and read-only safeguards. Explicit barriers
reject caller-owned BEGIN/SAVEPOINT transactions before export or timer
cancellation. Deferred exports wait until caller ownership ends; explicit disposal
rolls back uncommitted caller work and persists committed state. Failed startup
discards without export and retains the primary error. Started writes still queue
partial or committed-prefix effects when SQL throws; the SQL error takes priority
over a scheduling error. Read-snapshot APIs and native adapter policy are unchanged.

[ADR0006](adr/0006-sqljs-caller-transaction-persistence.md) records that ownership,
timer, cleanup and error policy. Its number is distinct from the existing human
status ADR; its normative policy text is retained. Writable sql.js remains an
exclusive-profile loaded image, without external-writer locking. An indefinitely
open caller transaction prevents a guaranteed one-second flush.

## Known disposal limitation

Calling `exec` or an already prepared `run` after sql.js disposal synchronously
rejects with `Database closed`. Its `finally` scheduling can briefly create the
existing two timer slots. In isolated fake-timer observations, the callbacks clear
both slots by 250 ms, export nothing and leave original file bytes unchanged.
They log a deferred persistence failure; later access can report the misleading
`persistence_transaction_state_unknown` diagnostic. This is a known nonblocking
misuse limitation. The integration does not expand the disposal fix.

## Validation and remaining gates

The combined source passes 2,619 Core tests with eleven existing skips, all 310
Desktop tests, production/test/fixture/harness types, normal builds, existing
security checks, architecture checks, 24 offline understanding cases, focused
sandboxed Electron journeys and the 22-case strict full smoke. All approved
persistence cases and earlier UI/history case names, statuses and multiplicities
remain represented. Raw cancellation observations retain diagnosed history through
two reopens on both adapters; a compiled sql.js probe retains caller savepoints
and committed state through two reopens.

The immutable review artifact binds inputs, conflict resolution, source matrix,
tested code and a documentation-only child to their exact identities. It preserves
the inherited extra blank EOF in an approved persistence test; the full patch
whitespace check reports that single formatting finding. The adapter and new
documentation pass their own whitespace checks.

See [verification](tool-result-verification.md) and [design QA](design-qa.md) for
counts, reproduction and scope. Final combined independent review and fresh CI
remain required before publication. Live provider delivery, real profiles,
complete chat UI disk restart and packaging are outside these results.
