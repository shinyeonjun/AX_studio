# Exact authoritative chat requests (P0)

This is the request-preservation slice, not the general read controller or a migration of legacy report inference.

## Host contract

`AuthoritativeRequestAnchor` version 1 records the complete accepted `text`, a SHA-256 UTF-8 digest, raw UTF-8 and serialized request-envelope sizes, `decisionTextComplete: true`, and optional original turn/session/catalog provenance. It is an immutable host record, not a model-created identifier or a grant of execution permission. A malformed, mismatched, wrong-version or ill-formed-Unicode anchor fails closed.

Desktop passes the synchronous connection snapshot's revision. Core admits the authoritative original request before preparing the lazy read catalog, invoking Jev, executing a pending command, selecting an explicit HTTP follow-up or queueing a command. The desktop's existing outer-whitespace normalization remains the accepted-text boundary; callers entering core directly retain their accepted whitespace exactly.

Every Jev chat control packet has the complete accepted text at `state.request` and non-text provenance at `state.request_anchor`. Argument, binding, structural-repair, final scope/requirements, read-parameter, workflow-step-removal, recovery and report-source selection phases retain the same request. Host-confirmed input values remain separate from the original task. They are not appended to a request or supplied as decision parameters. Blindly replacing all text equal to an input value was removed because it could erase an original prohibition. Synthetic tests verify that a private typed value stays out of decision packets and that a value coinciding with a prohibition does not remove it.

Scoped preferences, prior chat, catalog descriptions and labels remain advisory and retain their existing bounds and explicit `…[truncated]` omission marker. These are not complete-authority claims. Existing sensitive-parameter handling, data-policy checks, fixed read authorization, execution approval, cancellation and prose-only boundaries remain in force.

## Explicit input and packet policy

Defaults in `DEFAULT_AUTHORITATIVE_REQUEST_BUDGET`:

- Authoritative text: at most 8,192 raw UTF-8 bytes
- Serialized authoritative envelope: at most 16,384 UTF-8 bytes of `JSON.stringify({ request: exactText })`, including escaping and the envelope
- Full host decision packet: at most 1,048,576 UTF-8 bytes of `JSON.stringify({ state, questions })`, including all complete-request repetitions and metadata

The core chat/router/planner interfaces accept explicit `requestBudget` overrides. Limits must be positive safe integers. UTF-8 is counted without slicing JS code units; a supplementary Unicode character survives intact, and one byte over a configured boundary is refused. Lone surrogates are refused because UTF-8 replacement could make text and digest identities ambiguous. No authority summary or prefix is used to fit any limit.

Raw or escaped-envelope overflow is rejected at admission with zero underlying evaluator calls, zero lazy read catalog preparation, zero command-service execution/read/queue and zero prose generation. A packet is checked immediately before its evaluator callback. If a later phase exceeds the packet ceiling after earlier evaluations, those earlier evaluations cannot be undone, but the oversized phase is not dispatched and no command is returned or queued. The first-packet overflow test establishes zero evaluations and zero execution. Failures are typed (`AuthoritativeRequestError.failure`, router `request_rejected`, planner `requestFailure`, chat `onRequestRejected`) and the user receives a clarification.

This policy narrows the former desktop input acceptance of up to 50,000 characters: long input was previously accepted and silently prefixed for decisions; it now needs a shorter complete request. It also expands complete decision visibility beyond the former 2,048/2,000-character prefixes, only inside the explicit new byte limits.

### Provider cost and limits

The Jev adapter is unchanged. Its default 65,536-byte serialized provider-body ceiling, question validation, batch splitting, four-concurrent-batch limit, timeouts and response limits are unchanged. LLM prompt/token ceilings and planner phase/step limits are not raised. The 1 MiB host-packet ceiling is separate from a provider wire body and preserves the existing multi-batch short-request catalogs.

More complete request text can increase actual bytes/tokens per batch and can increase the number of batches when context is repeated. Thus this is not a fixed-cost or fixed-HTTP-call guarantee. Production adapter telemetry continues to report actual aggregate provider request bytes/counts. The host ceiling bounds a single pre-batch evaluation packet; it does not prove a turn-wide provider-call or aggregate-byte cap. Record a corresponding admission/cost policy before increasing overrides; this patch adds no UI setting or automatic limit increase.

## Compilation and persistence compatibility

- New `JevChatRequestPlan` records are version 2 and contain exact `request.message` plus the version-1 anchor. Versionless prior records remain historical, potentially bounded snapshots; no migration labels a historical prefix complete
- New compiled one-shot, manual workflow and generic recurring-job goals retain the full accepted request. Their optional `requestAnchor` survives the workflow gateway/schema and persistence. Workflow names remain bounded display metadata
- Unanchored legacy recurring-job goals retain their established trimmed 2,000-character validation. New anchored goals can exceed that old character cap because their host request admission is byte-budgeted. Anchor/goal or digest mismatch fails before a draft is created
- The optional workflow anchor records creation provenance. It is not standing authority and does not automatically become current authority after a later goal edit. A future runtime adapter must validate/re-anchor or invalidate such provenance rather than interpret it as permission
- New `report.generate` goals and saved report action parameters retain exact text and explicitly versioned provenance. A retry restores the original saved goal/anchor. Old report snapshots are restored without adding an anchor, changing checkpoint identities or reinterpreting their bounded goals
- The volatile pending cache is version 2. It compares the complete original request and SHA-256, exact form IDs and typed values, then atomically claims the host-held command. Replacement retains original intent/digest/provenance and rejects changed tails. Versionless records are refused; restart/expiry still returns the existing missing-plan result. This is not a migration of persistent pending records (the cache is memory-only)
- Executable discovery/source-search queries no longer use a shortened request prefix. A request outside the existing query command schema is refused and requires clarification; its constraints are not silently dropped. Short query behavior remains covered
- The explicit HTTP selection follow-up validates the original host-held intent before reading and uses that original intent for subsequent transform decisions

## Deliberate limits

No full read/evidence controller, connector pagination/ref registry, additional provider-call cap or runtime investigation migration is wired here. `runtime/investigation/decision-outputs.ts` still bounds existing `ai_decision` step goals. The report runtime still performs its legacy outer-whitespace trim and ignores anchor provenance when parsing report parameters; its capture/business/layout inference remains hybrid/legacy. This patch preserves saved report goals and does not claim that downstream reporting is Jev-only or revalidate every old persisted workflow.

Older binaries may discard the new optional provenance field; do not use such a downgrade as proof of complete request authority. Existing snapshots without that field continue to mean exactly what they meant before. A digest is integrity/provenance metadata, not authentication.

## Synthetic regression checks

Use an isolated checkout and dependencies with supported Node 22. Set
`AX_DATA_ROOT` to a scratch directory. No API keys, live providers, external
connectors, user data or production databases are needed.

After compiling core, run `node scripts/verification/exact-request-proof.mjs`.
It reads the immutable public baseline `9e993b1` with `git show` and compares only
pure synthetic helpers with the candidate source and built helpers. The baseline
route/final-review/report prefixes lose a late prohibition, and its pending cache
claims a different same-prefix task. The candidate must retain exact text and
refuse the pending collision.

Run the core and Desktop suites to cover the live decision phases, final review,
report command snapshots/resume, recurring proposals and pending-input flows.
These synthetic checks do not certify actual Jev quality, live connectors,
packaged GUI behavior or release readiness.
