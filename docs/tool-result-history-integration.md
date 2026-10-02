# Tool results with reviewed preview history

Status: local combined candidate; independent review required before publication.

## Exact inputs and scope

- Reviewed main: `41cf05691e30677fda2148ef5b88e79f0fb957f3`, the normal PR155 merge.
- Immutable editable-result and smoke input: `e74eb60b58007ecfe3412b85d446fb3bf1ff408a`.
- Common ancestor: `13446a568df671a18504386316d8f085c97def7c`.
- Isolated local branch: `feat/tool-results-main-integration`.

The two inputs change forty and 105 paths, respectively, and share eleven paths.
Earlier UI/smoke source, archives and checkouts remain immutable. This integration
does not include the c837 packaging lineage, canonical deployment, a real-profile
migration, activation, provider calls, external sends or database writes.

## Reconciliation

Three content conflicts are confined to `db-native.ts`, `db/sqljs.ts` and
`db/types.ts`. Both accepted contracts remain: synchronous read snapshots retain
their ownership/query guards, and synchronous committed-write barriers precede
external dispatch or acknowledgement. The sql.js barrier first checks snapshot
usability/read ownership, then rejects an open write transaction before export.

The read-only sql.js opener retains the tool input's verified `query_only` setting
and curated query allowlist, and main's guarded adapter and `readSnapshot` API.
Snapshot cleanup restores the original read-only setting. Closing a read-only
image never attaches a persistence path. Both original SQL validators remain;
neither is weakened. Native read snapshots and native read-only opening are kept
as reviewed. These are composition resolutions of ADR0002 and ADR0004, with no
new ownership, permission, retry, storage or architecture decision.

Eight shared files merge automatically. Approval rejection keeps draft discard,
conditional claim, durable acknowledgement and transcript publication while
retaining main's historical-evidence preservation option. Execution reads keep
the coherent historical log projection and bounded lazy-output API; the default
list omits bodies, while single-execution reads retain validated output. Workflow
store and preload/type/contract exports retain both APIs. The migration mock has
both required adapter methods.

Main's new migration fixture owner/cleanup lifecycle, preview readers, native
snapshot and guard tests, lazy activity output and resume-failure presentation
remain unchanged. Tool renderers, sealed confirmation, metadata fencing,
recovery/no-replay and the corrected synthetic Slack scenarios remain unchanged.
Source matrices and input-to-candidate diffs accompany the review artifact.

## Verification boundary

Combined checks are pending. The integration will run relevant historical
preservation, snapshot, lazy output, editable approval, metadata fencing and
recovery tests, complete Core/Desktop units, types, normal builds, architecture,
existing security checks and strict deterministic product smoke. Test children
use isolated synthetic data, inherit no provider credentials and retain the
existing external-network guard. Existing Electron launchers retain
`chromiumSandbox: true` and their no-bypass checks.

Previous input checks are evidence for their own source identities only. This
different tree requires its own validation and independent combined review. No
push, PR update, main merge, packaging, c837 retry or security/OS change is
authorized here. Live Gmail/Slack delivery, external databases and real profiles
remain outside the verification scope.
