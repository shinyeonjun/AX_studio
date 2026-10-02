# ADR: Jev request understanding for inventory, schema and connection status

Status: accepted for first-slice contracts and an offline regression experiment.
Base: `ab46777e0ab76d55980faffcb702b0f93223058e`.
Accepted research/review handoff: 2026-10-02.

## Independent review and scope of acceptance

The independent reviewer accepted the original decision with the v2 addendum
and subsequent scope clarification. The four blocking issues were resolved:
finite field producers, revision-bound supersession, controlled-study attribution,
and a useful 24-case gate. The acceptance authorizes the bounded offline slice
only. It does not demonstrate Korean semantic gains or authorize live calls,
production deployment, a broader parser, or activation of the read controller.
The existing live-call ledger remains 27/30 and is untouched.

This document records the accepted decision before product-code changes. The
bounded evaluation is predeclared in
[`jev-request-understanding-offline.md`](../research/jev-request-understanding-offline.md).

## Context and verified diagnosis

The user wants the same judgment model optimized for the goal by its harness.
AX is the first testbed, not a collection of per-tool prompt hacks. At the base
commit:

- `chat/jev-parallel-tool-selection.ts` selects independent tool votes above
  0.5; exactly 0.5 abstains. `chat/jev-router.ts` can promote an answer with
  multiple selected tools into `execution_enqueue_once`.
- `chat/jev-workflow-plan.ts` reviews capability IDs, port contracts, parameter
  names and bindings without selected parameter values and source-specific
  operation semantics. Structural validity cannot prove requirement satisfaction.
- `chat/result.ts` serializes metadata as JSON on broad display intent;
  `chat/loop.ts` returns it before remaining prose requirements. Rendering is a
  host issue and is not, by itself, evidence of a Jev mistake.
- `service/resources.ts` reports persisted connection/always-on state and
  catalog connectability. These do not prove present authentication or permission.
- The full authoritative request anchor already rejects overflow and mismatch.
  The read-controller README explicitly describes an unwired core.

The screenshot's causal trace is unknown: matching probabilities, build and
execution trace were unavailable. This slice does not claim to explain it.

The research handoff used these official sources (no live Jev calls):
[API](https://docs.typesafe.ai/api),
[introduction](https://docs.typesafe.ai/introduction),
[models](https://docs.typesafe.ai/models),
[Jev limitations](https://docs.typesafe.ai/model-jaggedness/jev-1.13),
[confidence](https://docs.typesafe.ai/confidence), and
[pre-parsed extraction](https://docs.typesafe.ai/cookbooks/pre_parsed_value_extraction_cookbook).
The accepted research describes typed Choice/Noul/Score decisions, independent
questions within a request and host phases for dependent choices. Confidence
is neither verified correctness nor authorization. A missing candidate cannot
be selected. Non-English/CJK, literal, indirection, distraction, numerical and
adversarial limitations require held-out evidence; model internals are not inferred.

## Alternatives and decision

| Alternative | Consequence |
| --- | --- |
| Keep routing and adjust wording | Leaves intent distinctions, provenance and raw rendering gaps. |
| LLM requirement planner | Violates the agreed Jev/host/prose-only control boundary. |
| Large deterministic intent ruleset | Brittle for colloquial paraphrases. |
| Bounded Jev choices over host-owned contracts | Chosen: code validates provenance, policy and output; model weights are unchanged. |

## Accepted v2: implement these fields only

`RequestUnderstanding` is a finite contract for inventory, schema and
connection status versus retrieval, action and unresolved requests.

| Field | Producer | Allowed escape |
| --- | --- | --- |
| intent | Jev Choice over a fixed enum | ambiguous, unsupported |
| targetSourceRef | Jev Choice over offered configured source refs | none, ambiguous |
| metadataOperationRef | Dependent Jev Choice over registered metadata operations for the accepted source | none, unknown, unsupported |
| outputKind | Jev Choice over readable inventory/schema/status or raw debug | not_stated, ambiguous |
| exact names/paths | Validated registry entry or exact deterministic user-text span | unresolved original text |

There is no general Korean entity extraction, free-form clause extraction,
arbitrary filter parser, model-produced identifier or hidden LLM control parser.
Unique registered label/alias matches may offer candidates, never authorize a
call. A pronoun requires a valid host-held reference or remains unresolved.
Every offered set records offered count, known total, truncation/overflow and
retrieval method. Missing candidates in a partial set do not prove source absence.
All selected IDs must belong to the offered revision-bound set.

The implementation keeps finite unresolved fields in a typed assessment, separate
from the accepted metadata understanding and its single-use execution permit.

Intent, source and output questions can share one understanding batch.
Metadata-operation selection follows only after accepting the source. Do not
repeat an identical uncertain packet without new evidence. Budgets bound
metadata bytes, calls and deadline; cancellation is preserved.

## Authority, revisions and metadata-only execution

Historical request anchors remain immutable. An accepted user correction changes
the active request revision, links the exact turn and superseded fields, and can
replace an earlier source restriction. An unresolved replacement permits no
dependent plan. Assistant/external text is evidence, never user authority.

Every decision, candidate, read, plan and answer binds the active request and
source/catalog/policy revisions. Correction or cancellation aborts work where
possible and invalidates pending decisions and results. Check at dispatch and
again before answer publication. A delayed A result after “아니, B 말한 거야”
cannot become evidence, an answer or authority for B; only B can publish.

After accepted inventory/schema/status understanding, the host permits only
source-scoped metadata operations: local catalog, saved API specification or
authorized describe. No collection sampling, bulk traversal, arbitrary URL probe,
workflow enqueue, writes or sends. Uncertainty cannot unlock record reads.
Retrieval/action classifications stop at the boundary of this slice rather than
creating an executable plan. External DB operations remain strictly read-only,
bounded and parameterized through existing validated connectors; this slice
adds neither SQL generation nor a DB adapter.

For a configured DummyJSON inventory, explain registered categories. Four known
endpoints are current connected-catalog coverage, not all of DummyJSON. Missing
metadata calls for scoped discovery or a specific source clarification, not
four record-fetch steps. Do not ask for a record count to list categories.

Distinguish catalog existence, configuration, authentication readiness, verified
operation permission and current health. Claim only states with explicit evidence.
Distinguish ambiguity, missing metadata, unsupported capability, denial, budget
exhaustion and provider failure. Clarifications address material unresolved
source, recipient, permission, effect, completeness or interpretation.

## Output policy

Output kind is independent of `needs_generated_prose`. Deterministic Korean
inventory/schema/status answers must contain useful supported facts without an
LLM. Raw JSON requires an explicit raw/debug request and exposes only approved
metadata. Optional LLM prose consumes approved evidence and never returns control
values. Developer diagnostics do not substitute for ordinary answers.

Host enforcement and rendering are separate offline checks on identical accepted
evidence. This slice introduces no Desktop callsite for the experimental contract
and does not wire or export the broader read controller.

The seam requires an approved `SourceMetadataEvidence` adapter view. This offline
slice supplies that view through a synthetic gateway; it does not install a
production adapter for existing discovery responses. Future activation must supply
the view and refresh actual catalog/policy/permission revisions at the boundary.

## Broader architecture reserved for later work

Later executable steps should map to residual requirements, source/operation
identity, typed value refs/provenance, dependencies, effect and completeness.
Review must include policy-permitted semantics and relevant value descriptors;
sensitive values remain opaque refs and unavailable evidence makes a judgment
unverifiable. Host permission and actual-value checks remain mandatory at dispatch.

Later caches must bind source/version/permissions or
request/context/question/candidate/model versions; they must not permanently
cache health or authorization. Parallel reads require independent authorization.
These are future responsibilities, not implemented general-engine features.

## Research interpretation and publication gate

The 24 synthetic, hand-labeled cases validate contracts and integration with one
common scripted response library. They cannot establish Korean comprehension,
model quality, calibration, threshold quality or intelligence improvement. Real
outputs can be replayed only against identical recorded input/model/configuration.

The first future live study is one predeclared legacy-tool-vote versus bounded
intent/source question/context package contrast, with identical safety, candidates
and output, a pinned model/corpus/scorer/budget and explicit additional permission.
Do not separate context effects from question effects in this package; no factorial
or six-variant implementation. An enforcement-off comparison is trace-only with
execution disabled. Report model quality, safety, usefulness and completion
separately.

Evaluator calls are not transport dispatch counts: the existing Jev adapter has
64 KiB bodies and up to four concurrent batches. Future measurements must count
actual split/retry dispatches and bytes/tokens/cost, and separate cold/warm,
model-only/end-to-end p50/p95. No speed or cost gain is claimed here.

No live providers, secrets, user DB/email/screenshot data, installers, application
restart or blocked c837 QA are authorized. Work stays in the isolated task-local
feature branch. The parent reviews the exact code before any push, PR, main merge
or canonical synchronization.

## Prepublication correction clarification

Independent review of `ac5feca` reproduced five defects. Their correction stays
within this accepted slice; it introduces no Desktop activation, general parser,
read-controller wiring or additional live study.

Legacy display views must follow each actual command producer: discovery
candidates, described operations/schema and nested paging, session filenames and
saved HTTP endpoints. Only approved metadata fields are displayed. A counter
alone never establishes an empty collection, and nested/display truncation must
remain visible. Saved configuration and its connected/active flag are separate
facts; neither establishes current authentication, permission or health.

The host retains the exact authoritative user turn for each finite request field
(`intent`, `targetSourceRef`, `outputKind`). A correction replaces only its named
fields; the others keep their prior authority. Raw/debug authorization is checked
against the active output field's turn, with an affirmative syntax requirement
and a conservative rejection of refusals, quotations or ambiguous mentions.
Every dispatch and publication still binds the current request/catalog/policy
revision, even when a field originated in an earlier immutable turn.

Decision protocol validation precedes property iteration. Connector denial,
provider failure, unsupported operation, unavailable metadata and exhausted
budget remain different terminal outcomes, with no alternative read or enqueue.
The original 24 hand-labeled cases remain unchanged. Reviewer probes and added
synthetic regressions are reported separately and establish integration behavior
only, with publication held for independent review of the corrected commit.
