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

Source inspection found one semantic conflict in the automatic execution merge:
main's history-preserving early return skipped the UI input's existing durable
completion barrier. The combined branch calls that same barrier before returning
without touching `log_json`, `output_json` or the raw tail. A crash-image regression
and an injected barrier-failure regression failed on the initial merge (three
controls passed, two failures). Both original reports are preserved. Applying
the existing barrier is a reconciliation of accepted behavior, not a new storage
or recovery design.

The first unchanged Desktop focused run passed 139 tests and failed thirteen.
Twelve main preview-rejection cases used a partial runtime object lacking draft
disposal; their fixture now uses an inactive real runtime with no connectors,
stops it and drains it before closing owned databases. All original history-byte,
terminal status, double-rejection and reopen assertions remain. The thirteenth
test now asserts the added `preserveHistory: false` argument in addition to its
original cancellation and observer-failure assertions. No runtime optional chain
or weakened historical preservation check was added.

Main's new migration fixture owner/cleanup lifecycle, preview readers, native
snapshot and guard tests, lazy activity output and resume-failure presentation
remain unchanged. Tool renderers, sealed confirmation, metadata fencing,
recovery/no-replay and the corrected synthetic Slack scenarios remain unchanged.
Source matrices and input-to-candidate diffs accompany the review artifact.

## Verification boundary

All final code checks ran on commit
`2c56816579f6cb327c3b2014ad49a71265118cfb`, tree
`ee695336231927b87b0b5aeeb498aaa329d6b8cf`. The final review commit only updates
these verification documents; the review artifact proves every code, fixture
and test blob is identical to that tested source.

| Check | Combined result |
| --- | --- |
| Core complete source suite | 2,540 passed, zero failed, eleven skipped; 2,551 tests across 482 files. |
| Desktop complete source suite | 310 passed, zero failed or skipped across 53 files. |
| New composition regressions | Five passed: native/sql.js snapshot barriers, read-only snapshot/query guards, durable history-preserving cancellation, and classified persistence failure with original cause. |
| Relevant contract coverage | All 26 Core and twelve Desktop focused contract files pass within the complete suites, including preview history, lazy output, native snapshots, migration ownership, editable approval, metadata fencing and no-replay. |
| Types and normal builds | Core production/test, Desktop, visual fixture and product harness types pass; normal Core and Desktop builds pass. |
| Existing security checks | Eight passed. Architecture has zero violations across 1,333 modules and 5,064 dependencies. |
| Offline request understanding | 24/24 cases passed, zero forbidden calls or generated-model/live-provider calls. |
| Strict deterministic full smoke | 22/22 Playwright tests and 22/22 scenario runs; zero unexpected, skipped, flaky or defective scenarios. |
| Repeated approval/cancellation journeys | 13/13 Playwright tests; four decisions twice plus five existing regressions. |
| Fresh pixel inspection | Five settled Slack flow captures at 1280 by 873 CSS pixels; draft, reviewed override, synthetic receipt, review before cancellation and cancelled result. |

All twelve synthetic decision runs match their complete final scenario definitions.
The evidence records zero dispatches before explicit confirmation, exactly one
literal edited payload after repeated confirmation input, and zero dispatches
after repeated cancellation. It also covers unchanged generic legacy decisions,
back navigation, review invalidation and keyboard focus restoration.

The eleven Core skips are existing environment/live boundaries: three POSIX or
symlink cases, one unavailable Python-engine integration, five live discovery
cases and two live Jev cases. They are not counted as passes. An initial complete
Desktop attempt passed 309 assertions but failed to load one suite because the
locked Electron executable was absent and its download was blocked by the network
guard. Materializing the exact locked executable from the existing task-local
cache resolved that dependency; the final complete run passed all 310. The first
post-fix composition report also retained one test expectation mismatch: the
persistence helper correctly classifies the injected failure. The final test
asserts both `database_persistence_failed` and its original cause. Earlier failures
remain in the artifact and are excluded from final passing counts.

Test children use isolated synthetic data, inherit no provider credentials and
retain the existing external-network guard. Existing Electron launchers retain
`chromiumSandbox: true` and their no-bypass checks. Normal Core build regeneration
produced only physical/literal CRLF formatting; a recorded normalization proof
preceded restoration of the exact tracked prompt bytes. The complete Core suite
then ran on those restored bytes. No generated prompt change is included.

The parent reported two faulted reviewer-owned Electron processes with cleanup
denied. They were left untouched: no alternate termination route or denial bypass
was attempted. They did not block these isolated combined QA runs.

Previous input checks are evidence for their own source identities only. This
different tree has its own validation above and still requires independent combined
review and fresh CI on any subsequently authorized published candidate. No
push, PR update, main merge, packaging, c837 retry or security/OS change is
authorized here. Live Gmail/Slack delivery, external databases and real profiles
remain outside the verification scope.

## Remaining design and release limits

The five fresh captures certify the synthetic Slack approval flow through the real
main/preload/runtime contracts. Review content scrolls vertically at this viewport;
focus and actual clicks reach the footer actions. They do not recertify Gmail/DB
pixels, every responsive size, real provider planning/delivery, menus/dialogs,
completed-chat disk restart or packaging. Earlier documented unsupported attachment,
thread/file, historical DB label/SQL and export capabilities remain unsupported.
Manual edits and review seals remain memory-only and require renewed review after
restart. Unknown outcomes never automatically resend. External databases remain
read-only. See [design QA](design-qa.md), [UI contracts](tool-result-ui-contracts.md)
and [ADR0004](adr/0004-tool-specific-editable-results.md) for the unchanged renderer,
extensibility and permission contracts.
