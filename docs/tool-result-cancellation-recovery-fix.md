# Preserve diagnosed history during interrupted cancellation recovery

Cancellation durably rejects an approval before execution completion. An
interruption at that boundary can leave a rejected final editable approval paired
with a pending execution and unreadable historical checkpoint or tail. Ordinary
startup completion previously replaced the checkpoint and triggered tail deletion,
even though terminal cancellation and zero sends appeared correct.

## Bounded correction

The rejected startup branch now chooses the existing `preserveHistory` option
using the same log-source diagnostic predicate as explicit IPC rejection. The
existing completion barrier persists `cancelled` / `approval_rejected` while
retaining checkpoint, output, IR and tail bytes. Valid history still receives
ordinary checkpoint replacement. Pending, processing and receipt recovery retain
their existing behavior; this is a diagnosed rejected-recovery correction.

[ADR0002](adr/0002-preview-history-compatibility-and-evidence-preservation.md)
governs immutable diagnosed evidence, and
[ADR0004](adr/0004-tool-specific-editable-results.md) requires recovery without
provider dispatch, identity lookup or reusable seals. The correction adds no
storage, permission, ownership or retry policy. The separately composed sql.js
ownership policy is recorded in
[ADR0006](adr/0006-sqljs-caller-transaction-persistence.md).

## Real-runtime regression boundary

The eight cases in `runtime/tool-result-history-cancellation-restart.test.ts`,
relative to `packages/core/src`, create valid final editable approvals through
`WorkflowRuntime.executeWorkflow` with action snapshots and synthetic workspace
sessions before introducing historical corruption.

- Four interruption cases cover malformed checkpoint and tail on native SQLite
  and sql.js. Native captures committed WAL after rejection and before completion;
  sql.js injects failure of the second barrier and copies the actual last disk
  image before deferred timers or disposal can flush memory. Original HEX must
  match before construction, after recovery and through a second runtime reopen.
- Two fully completed cancellation controls retain diagnosed history through both
  reopens. Two valid-history controls require normal checkpoint replacement and
  tail consumption, unchanged output/IR and unrelated rows, then stable reopen.
- Every case asserts terminal cancellation, absent drafts and zero provider sends
  or identity lookups on repeat continuation. Runtime admission stops and drains
  before owned databases close. Fixture cleanup verifies its resolved Temp parent
  and dedicated prefix.

The four interruption probes failed on the unchanged production baseline while
the completed controls passed. All eight pass on the corrected and final combined
sources. Optional raw observations do not alter normal execution. The immutable
review evidence retains failed-before reports and exact second-reopen bytes.

The final integration also preserves all previous Core/Desktop cases and all
approved persistence cases, including duplicate-title multiplicities. Full
verification and its independent-review/CI boundary are recorded in
[verification](tool-result-verification.md).
