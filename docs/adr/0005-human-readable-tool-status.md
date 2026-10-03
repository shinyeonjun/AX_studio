# Human-readable tool metadata preserves structured evidence

Status: **Partially implemented by existing catalog output; broader presentation proposal remains unimplemented**.
Date: 2026-10-02. Supplement to [ADR 0004](0004-tool-specific-editable-results.md).

## Current contract

`packages/core/src/intelligence/agent/commands/chat/metadata-output.ts` provides
bounded command-specific catalog presentation. `result.ts` preserves explicit
raw-format intent and structured command results. Tool-result panes consume typed
execution evidence separately; catalog text or configured connection labels must
not become an editable send, verified destination or completed action.

The existing experimental request-understanding seam remains disabled by default.
This presentation proposal changes no model selection, planning, semantic verdict,
metadata routing, activation or execution policy.

## Presentation direction

For ordinary inventory/status requests, use a deterministic allowlisted host
presentation. Show recognizable tool names, observed state and actions already
implemented and permitted in that state. Preserve structured results for host
processing, safe model context and typed UI. Do not strip JSON with generic regular
expressions or parse assistant prose to infer authority.

A configured `connected` flag does not establish fresh OAuth health or permission
to send. `connectable` describes catalog eligibility rather than readiness.
Registered, verified, unavailable and unknown states remain distinct. Unknown
tools and missing permissions cannot acquire guessed adapters or cosmetic actions.
Navigation or editing is offered only through an actual implemented action.

Respect explicit developer/raw JSON requests and legitimate JSON results. Select
human presentation from the command contract and output intent. Malformed metadata
produces a bounded error with no invented state, cause or action.

An unresolved or failed planning result must state whether anything executed or
queued. Show contextual missing input only when supplied by the authoritative
contract. Technical validation and dependency details may be collapsed as
diagnostics; they cannot imply an accepted plan or enable dispatch.

## Proposed verification and limits

Broader presentation work should test configured/verified/unknown/disconnected
states, empty/malformed metadata, unknown tools, unavailable actions, errors and
explicit JSON requests with synthetic fixtures. Verify that structured evidence
stays intact and diagnostics cannot imply execution. Inspect mounted rendering,
keyboard behavior and actual actions.

These broader acceptance cases are a proposal, not new implementation or evidence
of model quality. Existing catalog behavior stays intact. [ADR 0004](0004-tool-specific-editable-results.md)
continues to govern sealed send confirmation, receipt preservation and read-only
DB controls. Rollback must preserve structured evidence and execution state.
