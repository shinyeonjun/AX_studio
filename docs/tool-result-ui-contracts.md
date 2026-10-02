# Editable tool-result contracts

The existing Electron main process owns drafts, provider identity resolution,
confirmation seals and dispatch. IPC applies strict schemas and the existing
trusted-renderer checks. Renderer input is literal content rather than a workflow
or replacement identity. The browser-safe `@ax-studio/core/tool-result` export
contains pure contracts.

## Tool fields and provenance

| Tool | Editable or displayed fields | Authority and limitations |
| --- | --- | --- |
| Gmail | Recipient, optional subject and complete plain body | Known proposal values arrive filled. Review verifies the sending account. Attachments remain unsupported and block affected delivery. |
| Slack | Channel and complete message; verified workspace/channel at review | Existing authenticated connection resolves stable destination identifiers. Thread/file posting is unsupported and never silently becomes a channel message. |
| Database | Read-only table, execution-owned source, bounded scope/coverage and collapsed available conditions/query details | Provenance requires matching execution/query evidence. Exact SQL, historical friendly labels and export are unavailable where the source does not record them. |

Missing essentials produce contextual guidance and permit initial human writing.
No essential account, address, channel, connection label, SQL or total is invented.
Provider receipts are completion evidence; a draft or confirmation preview never
implies that a message was sent.

## Draft and confirmation lifecycle

One shared controller/editor serves chat and the existing approvals page. A
session/approval cache preserves manual edits during ordinary navigation. Review
displays the complete destination and literal payload before confirmation submits
an opaque host seal. Edits, back/context navigation, connection changes, deleted
sessions and stale responses invalidate that review.

Renderer synchronous locks and a host durable conditional claim prevent competing
confirmations from dispatching twice. Generic approval cannot bypass the seal.
Cancellation has a terminal state. A sent receipt or unknown outcome never exposes
automatic retry. Dispatch uses the connector instance/revision bound during review,
so changing settings cannot redirect an already reviewed send.

Drafts and seals stay in memory. Restart reconstructs only the original execution
snapshot and requires fresh review. Session deletion clears both host and renderer
draft state; a late identity lookup cannot restore deleted edits or seals.

## Receipts, persistence and refresh warnings

The claim/minimal intent is durable before external dispatch. Receipt, resolution,
completion and cancellation cross the existing synchronous persistence barrier
before acknowledgement. SQL.js uses a synchronized temporary snapshot and atomic
file replacement; native SQLite verifies FULL synchronous commits. Open
transactions cannot cross that barrier. Ordinary SQL.js writes retain deferred
batching. The extra synchronous I/O is the cost of reliable side-effect
acknowledgement; it adds no body snapshot, schema, credential policy or storage path.

Startup considers pending checkpoints, processing approvals and resolved final
approvals with active executions. It restores original-review reachability or
reconciles valid sent/unknown/cancelled outcomes through metadata only. Recovery
never resolves provider identity, sends a message or restores a seal. A recovery
persistence failure blocks startup completion and can be retried without dispatch.
Intermediate multirow states are recoverable rather than described as atomic.

The controller clones the returned outcome before presentation callbacks. A
callback cannot mutate the displayed receipt. If publication/refresh fails while
the editor remains mounted, completed fields are disabled and its receipt/warning
remain visible with no dispatch action. Replacement views subscribe to the same
controller by execution ID and tool so late warnings survive ordinary navigation.
Volatile presentation-action warnings are not promised to survive restart.

Bootstrap presentation failures are reported through the existing runtime warning
mechanism while retaining provider success. Persisted `execution_refresh_failed`
metadata can be recovered even when the old pending chat remains readable; no
approval is reopened and no provider operation is retried.

Cache-empty completed views keep their serialized authoritative outcome and read
warning metadata through `getToolResult({ executionId })` on mount/state changes.
This bounded exact one-key lookup reads execution error/log codes only. It returns
no draft or replacement outcome, resolves no identity, restores no seal and cannot
review, confirm or dispatch. Approval-ID lookups retain their original contract.

Missing or malformed warning metadata cannot invent a warning or downgrade a
known receipt. Lookup failure shows an evidence-read notice while preserving the
outcome. Persistence and refresh warnings remain distinct. Sequence, unmount and
execution/tool guards discard stale updates; no host I/O occurs during render.
Static SSR cannot establish completion of this asynchronous read.

## Transcript and metadata composition

Messages and their transcript revision are published as one captured pair. Initial
and final saves use the captured revision for compare-and-swap; a newer ref cannot
grant authority to an older callback. Stale whole-chat and metadata writers are
rejected without blind retry. Host-produced metadata receipts trigger a fresh
transcript read. Session deletion invalidates the transcript token and private
draft state while durable receipts retain their execution lifecycle.

This fence coexists with seals/claims rather than replacing them. Metadata
inventory is distinct from record reads and external effects. The existing
default-off request-understanding boundary and graph-before-binding preflight
remain intact.

## Database presentation and extension

Read-only badges require execution/query/source evidence. NULL and empty strings
remain distinct, and a partial page cannot imply a total. Current connection
settings cannot relabel historical rows. Legacy bounded command-chat results that
omit execution-owned source provenance remain unverified. There is no arbitrary
SQL editor or DB mutation action.

Adding an editable tool requires strict draft/result contracts, verified preparation
in its real connector, supported-field rules, an accurate renderer and isolated
lifecycle/confirmation/stale-response tests. Attachment/thread support requires
an explicit host payload/identity contract before controls are enabled.

[ADR 0004](adr/0004-tool-specific-editable-results.md), [verification](tool-result-verification.md),
[design QA](design-qa.md) and [native QA](tool-result-native-qa.md) define the remaining
capability and validation boundaries. Live delivery, complete production tool
preload IPC and the full completed-chat UI/cache disk-restart journey remain
uncertified.
