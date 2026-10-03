# Tool-specific editable results use verified, single-use confirmation

Status: **Accepted for bounded implementation and verification**.
Date: 2026-10-02.

## Context

AX Studio needs recognizable Gmail, Slack and read-only database results beside
the existing conversation. Known values should arrive filled, with initial human
writing and literal editing available. Missing essentials require contextual
guidance. The experience uses the existing pale lavender Electron UI, assets,
responsive panes and keyboard behavior without a tool-selection or blank setup
workflow.

Reference images informed the layout, but their sample content does not establish
connector capabilities. The supported payloads are Gmail recipient, optional
subject and plain body; Slack channel and text; and bounded database table reads.
Gmail attachments, Slack threads/files, arbitrary SQL and export are outside the
implemented contracts. These limitations remain visible and cannot be silently
removed from a requested action.

## Decision and alternatives

Use typed tool panes at the existing host/runtime approval boundary. Reuse
`ChatMainPage`, `WorkConversationSplit`, connector branding, execution snapshots,
approval claims and persistence. Editable send support applies only to a final
one-shot message with no remaining steps, outer continuation or grouped approval
consequences.

| Alternative | Tradeoff |
| --- | --- |
| Generic result cards | Preserve the old surface but do not provide editable results. |
| Send manual edits through model chat | Can reinterpret literal content and change the intended payload. |
| Call providers from the renderer | Moves credentials and external authority across the trusted boundary. |
| Re-enqueue the plan | Can replay earlier side effects. |
| Typed pane at the approval boundary | Requires verified identity and shared confirmation enforcement, while retaining literal edits and execution evidence. |

Other workflows retain their validated existing path and must not imply support
for editable sends. General AX navigation remains independent of any one tool or
document format.

## Identity, destination and confirmation

Autofill identity and destination from validated execution bindings and
authenticated connector context. Configuration labels are display hints. Gmail
requires the authenticated account tied to the credential binding; a failed
profile lookup blocks review. Explicit human recipient input must satisfy the
recipient/header contract. A display name cannot supply a guessed address.

Slack requires the authenticated workspace and sending user/bot identifiers.
Resolve the destination through the same connection to a stable workspace/channel
binding. A channel-shaped string is insufficient. Missing or ambiguous targets
remain editable and unsent until resolved. Verification uses existing permissions;
the UI does not add OAuth grants or credential setup.

The host keeps the draft revision in memory. Every edit immediately disables
confirmation and advances that revision. Review returns an immutable, single-use
host seal binding the provider, authenticated sender, stable destination, complete
literal content/digest, draft revision, approval/execution/session/action IDs,
original binding hash and connection instance/revision. Confirmation submits this
opaque seal after displaying the exact snapshot.

Edits, account/destination/connection changes, session or tool replacement,
cancellation, restart and later revisions invalidate the seal. Stale asynchronous
reviews cannot replace a newer review, including at the same draft revision.
Every approval entry point, including `ax:approve`, Activity and direct runtime
continuation, enforces the same boundary. Switching to an original payload requires
its complete preview and a fresh seal.

Strict allowlisted schemas validate before claim and at the connector boundary.
Unsupported delivery fields fail closed on generic and editable routes. A
thread-targeted Slack request cannot become a channel post by dropping the thread
field. An explicit change to a top-level message is a new revision requiring fresh
review. Attachments and files likewise remain visible and blocked where requested.

## Dispatch, outcomes and cancellation

Validate the seal, original binding, essentials, supported capability and current
connection before claiming the action. Pin the validated connector instance and
credential binding to dispatch. Apply the edited payload literally once, without
template interpolation or rerunning preparation.

| State or event | Required behavior |
| --- | --- |
| Invalid or stale preflight | Zero sends; approval stays pending and editable. |
| Cancellation wins before claim | Zero sends; durable cancellation and no reusable seal. |
| Claim wins | One runner owns dispatch; competing confirmations send zero times. |
| Provider success | Success with provider receipt and reviewed destination/content digest. |
| Claimed dispatch has an uncertain outcome | Terminal unknown outcome; consumed seal and no automatic retry. |
| Back or cancel after dispatch begins | Show current sending/outcome state without promising retraction. |

The conditional claim and minimal intent cross a synchronous database persistence
barrier before dispatch. Receipts, outcome resolution, completion and cancellation
also cross the barrier before acknowledgement. Existing storage paths, database
schema and retention rules remain in use. This is not an atomic multirow commit;
startup reconciles valid intermediate approval/execution states using metadata
only, without identity lookup, provider dispatch or a reusable seal.

A reservation-persistence failure sends nothing, preserves manual edits and
requires fresh review. An acknowledged claim without a durable receipt becomes
unknown on recovery. A known receipt with later completion or refresh failure
remains success with a warning; it cannot become a retryable send. Cancellation
is not acknowledged if its durable rejection fails.

## Draft lifetime and historical evidence

Unsent edits and seals are memory-only. Cache them above disposable panes by
session/approval so ordinary navigation preserves edits and unresolved work stays
reachable through session/result or Activity navigation. Returning to a draft
never sends it. Back/context navigation does not cancel an in-flight dispatch;
late replies remain tied to their original approval, session and revision.

The UI discloses edit loss on restart. A reopened pending approval reconstructs
the original frozen execution snapshot, verifies its hash and requires fresh
review. It does not claim to restore manual edits. If exact original content is
unavailable, review is blocked. Unknown outcomes remain terminal; unavailable
edited content is identified as unavailable instead of replaced with the original
body.

Do not add another message body to approval metadata, result references, logs or
telemetry. Added receipt, digest and binding metadata follows the existing execution
lifecycle. Chat deletion removes chat content rather than separate execution
history. Existing terminal-execution deletion removes its approval/execution
records; open/processing deletion stays guarded. Session deletion clears private
drafts/seals, and late reviews cannot restore them.

## Read-only databases and extensibility

Use registered read actions with `NONE` side effects, allowlisted tables/schemas
and bounded parameterized reads. SQLite uses read-only opening/query enforcement;
PostgreSQL/MySQL establish read-only transactions before reads and close on setup
failure. If read-only enforcement cannot be established, block the read. There is
no renderer SQL editor or database write endpoint.

Rows, source provenance, scope and coverage come from the same execution and
survive serialization together. Current connection settings cannot relabel old
rows. Distinguish NULL, empty strings, empty/truncated pages and bounded page
counts; unknown totals remain unknown. Collapsed SQL/conditions display only
recorded execution details. Legacy command-chat tables lacking source provenance
remain unverified.

A new editable tool requires a registered host adapter, strict schema, verified
identity/destination, explicit side-effect declaration, execution mapping and
lifecycle contract tests. Unknown tools retain their safe existing path. New
attachment/thread support needs an explicit host payload and identity contract
before editable controls can be enabled.

## Validation, rollout and rollback

Validate literal overrides, missing essentials, unsupported fields, generic-route
rejection, seal invalidation, stale responses, double-click/cancel races, durable
claims/receipts, restart without replay and DB read-only provenance with isolated
synthetic fixtures. Renderer checks cover initial writing, focus, back/cancel,
responsive panes and reference-sized pixels. Electron launchers use
`chromiumSandbox: true` and reject sandbox/security bypasses.

Recorded results and limits are in [the verification guide](../tool-result-verification.md)
and [design QA](../design-qa.md). Synthetic checks do not certify live delivery,
complete production tool IPC or the full completed-chat disk-restart journey.
Attachment/thread sending remains an unmet capability where requested.

Block rollout for mismatched payloads, generic approval bypass, lost unsupported
intent, duplicate/replayed sends, stale identity/seals or DB write exposure.
Rollback may disable the pane/adapter while preserving execution evidence and
shared confirmation gates. Outstanding approvals require fresh complete review
or explicit cancellation; completed and uncertain actions stay terminal.

This retains the authority boundaries in
[architecture decisions](../project/architecture-decisions.md) and ADR 0001's
evidence/stale-mutation principles. Memory-only edits do not change Work
Discovery's durable session/publication contract.
