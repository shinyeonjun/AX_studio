# Proposal: one missing schema-selection answer

Status: design independently approved at `a2b69f3773813045a025395be01f077dc6e34b2b`;
the isolated default-off implementation is pending independent code review.
Production activation remains separately gated. The original approved document's
SHA-256 is `5906362c20c972ebb0baf088471c2e648f39fc9de4b72c941474d3a5dc5dd847`.
The independently approved offline experiment at
`d2ecd0caa6157b59b81ca5873cc9f554c284471b` is finished: 19/43 full completions,
24/43 noncompletions. Its passing contract checks establish no production gain.
Current canonical integration source was read-only verified at
`079a8c9fbc4b51812802e971971b101db682444d`; scoped files match this checkout.

## Smallest proposed user benefit

For “OrdersAPI 등록 필드와 타입 알려줘”, valid intent/source/output can already be
accepted, yet Jev's second response omitting `metadataOperationRef` throws at
`intelligence/decision/jev.ts:489`; the reader's catch returns `provider_failure`.
Propose one host resolution **before terminalization** when
there is exactly one current registered local schema operation. Execute the
normal first metadata read and answer from the validated registered dictionary.
Do not repeat the evaluator, reader or read; do not change confidence thresholds.
This targets schema selection, separate from the inventory admission/adapter fix.

Eligibility requires all of the following:

- Host flag on; already admitted readable-schema request; normal intent/source/
  output validation and exact request/field authorities passed.
- Only the guarded operation evaluation failed with the recognized host-parser
  error type and new closed tag `missing_answer` for `metadataOperationRef`.
  Recovery-specific question-key validation must first establish a valid
  envelope and answer container/shapes, omission of the sole requested operation
  slot, and **no unrequested answer keys**: the parsed answer-key set is empty.
  The implementation also requires only the declared envelope keys (`answers`,
  optional `model/usage`); an `error` or other undeclared key, even with HTTP 200,
  cannot mint the recovery tag. Ordinary successful-answer parsing is unchanged.
  Only this clean omission may receive the eligible tag. A well-shaped answer
  under a wrong question ID is ineligible even though it currently reaches the
  same missing-slot error. Do not parse human error messages to authorize recovery.
  Wrong-question, malformed envelope/answer/container, HTTP/provider/transport
  failures, tied/subthreshold votes and valid `none/unknown/unsupported` answers
  retain their existing stops.
- Source and operation coverage are complete, not truncated/overflowed. Exactly
  one matching schema operation exists **before** permission filtering, is allowed,
  and has the exact source-bound `discovery.describe(depth=schema)` contract.
- The session privately holds the current `registered_http_metadata` adapter;
  current request, source, catalog, policy and store revisions still match.

No dictionary is presumed to exist. Missing/invalid/oversized evidence remains
noncompletion after that one allowed read. Source ambiguity, raw output, retrieval,
effects, multi-operation choice and every existing terminal receipt stay outside
this exception. Record the host producer and retained
`missing_metadata_operation_answer` cause; never attribute a host choice to Jev.

## Narrow integration and ADR amendment

| Exact path/seam | Proposed change |
| --- | --- |
| `packages/core/src/intelligence/decision/jev.ts:JevDecisionError,201-213,276-285,487-489` | Recovery-specific key validation; tag only a clean omission with no unrequested keys. Preserve its closed kind/requested-question ref through the evaluate error wrapper, with abort and request/byte accounting unchanged. Ordinary parsing and other failures remain unchanged. |
| `packages/core/src/intelligence/agent/commands/chat/request-understanding.ts:41,150-173` | Default-false host option; phase-local typed-error handling and pure singleton guard before terminalization. Charge the single first metadata attempt before execute; reuse existing understanding, permit, validation and rendering. |
| `packages/core/src/contracts/request-understanding.ts:RequestUnderstandingResult` | Bounded host-resolution provenance/cause; no model-supplied execution authority. |
| `packages/core/src/intelligence/decision/request-understanding/session.ts:permit/private metadataAdapter` | Narrow current-local-adapter eligibility predicate; existing permit/grant checks and single-use registry unchanged. |
| `apps/desktop/electron/main/ipc/workspace-chat-command-handlers/metadata-turns.ts:OfflineInstallation,146` | After the separate patch is reviewed, pass one trusted installation option. Consume its admission/snapshot/CAS/publication fences; do not recreate them. |
| `packages/core/src/intelligence/agent/commands/chat/request-understanding.singleton-schema.test.ts` (proposed), existing `request-understanding.*test.ts`, Desktop `metadata-turns.offline.test.ts` | New positive/negative cases and existing reader/IPC regressions with real local service/store and injected evaluator transport. |

Leave router/workflow planning, inventory adapter, normal dispatch and transcript
persistence owners untouched. No broad controller or prototype code is wired.

Amend [request-understanding ADR](../architecture/jev-request-understanding.md)
"Accepted v2" to permit this sole host-produced schema selection, and its
“Prepublication correction clarification” to place the exception before a stop.
Amend [Desktop ADR](../architecture/registered-http-metadata-desktop.md) section 1
with the same internal/default-off predicate. Preserve explicitly:

> Once any reader outcome is terminal, no automatic read, alternative, enqueue
> or resumption follows. This pre-terminal missing-slot resolution permits at
> most the normal first local schema read. Denial, other provider/transport failure, unavailable
> metadata, unsupported operation, budget exhaustion, stale/cancelled requests
> and publication conflict keep their existing terminal guarantees.

ADR 0008's offline-only recovery examples remain offline-only; no retry amendment
is proposed. Desktop fresh-turn-only continuation remains unchanged.

## Before/after acceptance and rollback

Freeze three independent Korean schema paraphrases, one synthetic stored field
dictionary and paired flag-off/on expectations before execution. First batch is
valid; second batch has a valid envelope and clean empty answers (`answers: {}`).
Use the real trusted IPC,
session, service, adapter and in-memory store; network/body/queue/prose stubs fail
if reached. This validates integration, not real-model Korean quality.
The table below states future acceptance targets.

| Case | Required before/after evidence |
| --- | --- |
| Three eligible requests | Off: 0/3 completed, `provider_failure`, zero reads. On: 3/3 completed with exact dictionary facts/scope, one reserved read and one recognized permit each. Two evaluations unchanged; no added model/transport call or clarification. |
| Normal answered selection; flag absent/off; ordinary chat | Existing behavior and call counts unchanged. |
| Operation slot absent with a well-shaped answer under `wrong_question` (an unrequested key) | Paired off/on: existing stop, zero host resolution, zero metadata reads/dispatch, no extra evaluation/read. Do not mint the eligible clean-omission tag. |
| Operation-evaluation malformed envelope/answer/container (including missing answers container), HTTP/provider/transport failure | Paired off/on: existing stops, zero metadata reads/dispatch, no host resolution or extra evaluation/read. |
| Registered source exists but the user metadata goal/target is absent or a pronoun is unresolved; initial fields remain unresolved | Paired off/on: original stop/scoped question, zero host resolution or metadata read. Availability cannot supply user authority. |
| Ties; valid escape; two schema operations; incomplete coverage; nonlocal adapter; denied grant | No host resolution, no metadata dispatch from the rejected selection; preserve actual reason. |
| Missing dictionary, bad revision/shape, oversized result | Never full completion; charge failed first read; no second read or body fallback. |
| Cancel/stale/new turn/flag change; ignored abort; final CAS conflict | No old evidence/reply publication or renewed execution. |

Retain the failed selection in diagnostics even when the task completes.
Report full task completions, required/unnecessary clarification, safety rejection,
failed reads and dispatch/latency separately over **all** cases. An actionable
refusal is not task success. Do not reuse 43/43 as an integration success rate.
Measure live prevalence/gain only in a later separately authorized study.

The flag is absent/false by default and initially test-installation-only. No UI,
environment-only enablement or ordinary-language activation is added. Disable by
reinstalling policy off, advancing the existing policy epoch and invalidating
in-flight turns; new requests follow the old selection stop. No data migration or
transcript rewrite is needed. Production activation remains a separate review.

## The 24 retained noncompletions

Every case remains legitimate noncompletion with its frozen facts. Future
opportunities below need new input, evidence, authority or a reviewed capability;
they do not reopen the stopped generation.

| Cases (count) | Present constraint / possible supported future path |
| --- | --- |
| R10/R12/R13/R23 (4) | Missing/ambiguous source: retain one scoped question; only an explicit answer plus new anchor can complete. |
| R15/R26/R30 (3) | Complete local lookup has no source, or required metadata is unavailable: explicit registration/new authoritative metadata, not invented empty/upstream data. |
| R16/R19 (2) | Delete/forecast unsupported: a separately reviewed capability or a user-revised goal. |
| R17/R18/R27/R32/R35/R36 (6) | Effect review, scope/permission, wrong year or forged identity: actual approval/authority/correct evidence required; no automatic bypass. R27's inventory remains useful partial work. |
| R28/R38 (2) | Upstream completeness unproved or cursor cycle: a reviewed complete snapshot/paging contract, or explicitly narrowed goal. |
| R33/R34 (2) | Stale/cancelled: preserve the stop; a new explicitly admitted request is independent. |
| R22/R37/R39/R40/R43 (5) | Invalid decision after reframe, no progress, deadline, budget or status service failure: future protocol/harness/service improvements may prevent the cause; no replay of identical packets, limit inflation or inferred healthy status. |

The selected **schema-slot** omission is a new narrow integration case; R22's
invalid initial understanding is not eligible. None of these 24 is relabelled or
claimed recovered by this proposal. Further alternatives/retries are deferred.

Implementation review must use the new isolated patch and paired offline IPC
regressions. This accepted design does not authorize remote calls or activation.

Source-reference note: the canonical active worktree is
`test/windows-integration-20261001@079a8c9f`; the common repository's literal packed
`refs/heads/main` is `23fc744164f9476085fa6266b3d0279ddf5c85d1`, a verified older
ancestor, not a newer divergence. Use a fresh isolated implementation branch at
exact `079a8c9fbc4b51812802e971971b101db682444d` or a separately verified reviewed
descendant. Carry only approved documentation changes; do not merge the offline
prototype branch or reset canonical refs.
