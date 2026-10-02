# Local review checkpoint: Jev request-understanding first slice

Base: `ab46777e0ab76d55980faffcb702b0f93223058e`.
Branch: `feat/jev-decision-harness-offline`.
The accepted [ADR](../architecture/jev-request-understanding.md) and
[evaluation design](jev-request-understanding-offline.md) were written before
product code. The earlier optional ADR question is resolved. No task blocker
remains; exact code and concrete fixture labels await parent review before any
publication or canonical synchronization.

## Result and supporting evidence

- **24/24 corpus cases pass**, with zero forbidden calls and zero generated-model
  calls. Ten cases require useful answers; the other cases require their specific
  clarification or invalidation/cancellation outcome. Always-abstain and
  always-clarify baselines fail the useful-case scorer.
- The run observes 13 source-scoped metadata dispatches and 41 scripted evaluator
  phases across all revisions. These are not provider transport counts or cost
  measurements. No live Jev/provider call occurred; the 27/30 ledger is unchanged.
- Latest regression: **487 tests in 57 files pass**. This includes real chat/service,
  request-anchor, permission/cancellation, the existing unwired read-controller
  suite and plain-chat safety. Live tests are explicitly excluded.
- Final focused suite: 55 tests in three files pass. This includes the 24-case
  corpus, non-vacuous scorer, unrequested raw-output refusal, metadata byte/source
  validation, renderer and single-use permit guards.
- Both production and test core TypeScript checks pass. Dependency/webhook security
  checks pass (8 tests). Architecture checking finds no violations across 1,298
  modules / 4,821 dependencies. `git diff --check` passes with repository EOL rules.

The tracked [compact per-case evidence](jev-request-understanding-results.json)
contains observed replies, stopping outcomes, dispatch/phase counts and published
source identities. Full local observations and test reports are under
`build-evidence/jev-request-understanding/`: `summary.json`, `vitest.json`,
`regression.json`, and `final-focused.json`. These scratch artifacts are ignored
by Git and contain synthetic data only.

Reproduce the bounded corpus with supported Node 22 and existing dependencies:

```text
node scripts/verification/request-understanding-offline.mjs
```

The runner uses sql.js and a task-local scratch data root. Dependencies were
copied into this checkout from an existing checkout with the same npm lock hash;
no installer or Python package installation ran.

## Implemented behavior

The explicit experimental `runAxCommandChat` seam performs one finite
intent/source/output batch and one dependent metadata-operation choice. It keeps
unresolved field states in a typed assessment. Accepted choices map to immutable
host registry entries and exact request spans. A source-bound, revision-bound,
single-use permit reaches the real `AxCommandService`, which checks before dispatch
and after the awaited result. Corrections preserve historical anchors, advance
the active revision and supersede the named fields. Cancellation and stale results
cannot publish evidence or an answer.

The registry accepts only scoped `discovery.describe` or source-bound
`rdb.schema.describe` commands; it excludes collection retrieval, raw SQL, arbitrary
HTTP probes, queueing, writes and sends. Actual existing gateway permissions still
apply. The finite decision result never produces a raw ID, query or parameter.

Readable Korean metadata is independent of the generated-prose flag. Raw JSON
requires explicit syntax and includes only approved metadata. The legacy metadata
renderer now uses readable allowlisted facts by default; saved HTTP configuration
readiness no longer claims live operation availability.

## Changed files

Documentation and evidence:

- `docs/architecture/jev-request-understanding.md`
- `docs/research/jev-request-understanding-offline.md`
- `docs/research/jev-request-understanding-checkpoint.md`
- `docs/research/jev-request-understanding-results.json`

Contracts, lifecycle and service guards:

- `packages/core/src/contracts/request-understanding.ts`
- `packages/core/src/intelligence/decision/request-understanding/session.ts`
- `packages/core/src/intelligence/agent/commands/chat.ts`
- `packages/core/src/intelligence/agent/commands/chat/contracts.ts`
- `packages/core/src/intelligence/agent/commands/chat/request-understanding.ts`
- `packages/core/src/intelligence/agent/commands/service.ts`
- `packages/core/src/intelligence/agent/commands/service/contracts.ts`

Rendering:

- `packages/core/src/intelligence/agent/commands/chat/metadata-output.ts`
- `packages/core/src/intelligence/agent/commands/chat/result.ts`

Fixture and verification code:

- `packages/core/src/intelligence/agent/commands/chat/request-understanding-cases.json`
- `packages/core/src/intelligence/agent/commands/chat/request-understanding.offline.test.ts`
- `packages/core/src/intelligence/decision/request-understanding/session.test.ts`
- `packages/core/src/intelligence/agent/commands/chat/result.test.ts`
- `packages/core/src/intelligence/agent/commands/chat/command-loop.test.ts`
- `scripts/verification/request-understanding-offline.mjs`

No Desktop/UI, main/canonical checkout, other-worker source, dependency lock,
installer, app-restart or blocked c837 QA change is included. The incidental
generated embedded-prompt EOL change was restored.

## Limits and next permission boundary

These scripts validate deterministic host behavior and integration, not Korean
comprehension, selective accuracy, calibration or model-intelligence gains. The
screenshot's causal trace remains unproven. The legacy tool-vote router and broader
workflow semantic-review limitations are not rewritten here.

There is no Desktop producer/callsite for the experimental seam and no production
`SourceMetadataEvidence` adapter. The existing read controller remains unwired.
Future integration must supply approved evidence and current real permissions and
source/catalog/policy revisions. Metadata body/response limits and abort checks
do not forcibly stop an adapter that ignores its signal.

The one registered future study compares the legacy tool-vote question/context
package with the bounded intent/source package, holding model/configuration,
candidate snapshot, host safety and output constant. It requires explicit new
live-study permission and a pinned corpus/scorer/transport-call/byte/cost budget.
No factorial variants, model performance claim, push, PR, main merge or canonical
sync is authorized by this checkpoint. Parent exact-code and hand-label review
is the next step.
