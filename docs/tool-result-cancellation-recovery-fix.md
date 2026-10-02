# Preserve diagnosed history during interrupted cancellation recovery

Status: local fix for exact-commit independent re-review; unpublished.

## Source and governing contract

This isolated branch starts from reviewed combined candidate
`ac8c88231c48f1127916e160dfe9c891d0ad2f4c`, tree
`8a7c78c28f63a2707005ac6c574533fb14f1eedc`. Its source, review ZIP and prior
evidence remain unchanged. Final code checks use
`98b39139fbfa1e117cca5d3b8eef6cfc46f52fde`, tree
`bd3d593fecf5fd0ef5c428fb6a72c869a0700b34`. The final review commit changes
verification documents only; its artifact proves identical code/test modes and blobs.

[ADR0002](adr/0002-preview-history-compatibility-and-evidence-preservation.md)
already requires rejection with log-source diagnostics to change only terminal
lifecycle metadata while retaining checkpoint/output/IR/tail bytes through two
reopens. [ADR0004](adr/0004-tool-specific-editable-results.md) admits separately
durable approval/execution states and requires recovery without identity lookup,
provider dispatch or a reusable review seal. No new architecture, storage,
ownership, permission or retry decision is introduced.

## Failure and bounded correction

A legitimate final one-shot editable approval can remain recoverable when its
preview checkpoint or tail is unreadable. Cancellation durably rejects its approval
before the execution completion write. Interruption at that boundary leaves a
rejected approval paired with a pending execution and original historical bytes.
The startup rejected branch formerly used ordinary `finishExecution`, replacing
`log_json` and firing the preview trigger that deletes the raw tail. Terminal
cancellation and zero sends still passed, so they did not establish preservation.

Startup rejection now selects the existing `preserveHistory` option using the same
log-source diagnostic predicate as explicit IPC rejection. The existing completion
barrier durably persists `cancelled`/`approval_rejected` without replacing checkpoint,
output, IR or tail. Valid history retains ordinary checkpoint replacement. The
change is confined to `ToolResultApprovals`' rejected branch. Pending, processing
and receipt branches were inspected; their existing behavior is not expanded by
this cancellation-only fix. This does not make all runtime writes immutable.

All persistence adapters, the completion repository/barrier, migration owners,
renderer/styles, confirmation gates, metadata fences and launchers retain their
base blobs. The separately reproduced sql.js caller-savepoint ownership defect is
assigned to another isolated author branch. It is not fixed here, and this change
does not certify savepoint export/close/timer ownership. Both reviewed fixes must
be reconciled and reviewed before combined publication.

## Regression evidence

The imported reviewer probes create actual editable approvals through
`WorkflowRuntime.executeWorkflow` with valid action snapshots, checkpoint metadata
and an owned synthetic workspace session. They validate the draft/classifier before
corrupting only the historical checkpoint or tail in owned preview-compatible files.

- Native SQLite captures committed WAL state after durable rejection and before
  completion. sql.js injects failure of the second persistence barrier and copies
  the last actual disk image before timers or close can flush memory.
- Four cases cover both adapters and malformed checkpoint/tail. Original HEX must
  match before runtime construction, after recovery and on a second runtime reopen.
  Status/error remain cancelled/rejected, drafts stay absent and repeat continuation
  causes zero sends and zero identity lookups.
- Two completed-cancellation controls preserve corrupt history through both reopens.
  Two valid-history controls require normal checkpoint replacement/tail consumption,
  unchanged output/IR and unrelated rows, then stable terminal bytes on reopen.
- Runtime admission is stopped and drained before owned databases close; recursive
  fixture cleanup verifies the resolved Temp parent and its dedicated prefix.
  Optional raw observation output does not affect normal test execution.

The frozen test-only baseline passes two controls and fails all four interruption
cases at original-history equality, reproducing the review. The first fixed run
passes all eight; test types then caught the imported synthetic sender's widened
provider literal. A test-only correction narrows it to `gmail`. The final typed
source passes all eight and retains raw HEX/hash observations. Earlier reports,
including the type failure, remain preserved and are not final passing evidence.

## Final checks and limits

| Check | Result on the final tested code |
| --- | --- |
| Complete Core | 2,548 passed, zero failed, eleven existing skips; 2,559 total across 483 files. |
| Complete Desktop | 310 passed, zero failed/skipped across 53 files. |
| Relevant contracts | All 27 Core and twelve Desktop focused files pass in the complete suites, including the prior five composition cases, history/snapshots, migration ownership, approvals, metadata and recovery. |
| Types/builds | Core production/test, Desktop, fixture and harness types; normal Core/Desktop builds pass. |
| Security/architecture | Existing security 8/8; zero architecture violations, 1,334 modules / 5,076 dependencies. |
| Offline understanding | 24/24 with zero forbidden/generated-model/live-provider calls. |
| Sandboxed Electron | Focused 13/13 and strict full smoke 22/22, no unexpected/flaky/skipped tests; twelve complete synthetic decision runs retain exact payload/count evidence. |
| Fresh pixels | Five settled Slack states inspected at 1280 by 873 CSS pixels; draft, reviewed override, synthetic receipt, review before cancellation and cancelled context. |

Every previous Core/Desktop test name, status and duplicate-title multiplicity is
retained; the only added unit cases are these eight. The eleven skips retain the
existing POSIX/symlink, unavailable Python-engine and live-discovery/Jev boundaries.
Normal Core prompt generation is proved to differ only in physical/literal CRLF
formatting and restored before the final source suite. No prompt delta is included.
These workspaces define no dedicated lint command; Git whitespace checks pass.

Filesystem and command access were verified after executor-disconnect callbacks;
the existing run was polled, with no uncertain command restarted or duplicated.
Existing Electron launchers keep `chromiumSandbox: true` and no-bypass assertions.
Faulted reviewer-owned processes remain untouched. All children use synthetic files,
no inherited provider credentials and the external Node transport guard. No real
profile, Jev/provider budget, Gmail/Slack send, external database activity, grant/key,
canonical edit, OS/security change, packaging or c837 retry occurred.

Fresh visual scope is the same narrow synthetic Slack flow. The review pane scrolls
vertically, with focus and real clicks reaching its controls. Gmail/DB pixels,
other viewport sizes, complete disk-restart UI, live delivery, menus/dialogs and
packaging remain uncertified. Existing unsupported capabilities and memory-only
draft/seal lifetime remain documented. No push, PR update, merge or release.
Independent re-review of this exact fix, the separate savepoint fix, their eventual
combined source and fresh CI remain required.
