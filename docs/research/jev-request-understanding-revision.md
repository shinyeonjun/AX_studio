# Prepublication revision checkpoint

The original candidate `ac5feca0aba1d873875d7b6411a779bd1e13a670` is preserved in
history. This revision follows the independent **REVISE** report and ten unchanged
reviewer repros from the authorized task-10 workspace. The exact corrected commit
is the commit containing this checkpoint; its hash is supplied in the handoff.
Publication is held for independent rereview. No push, PR, merge, Desktop
activation or canonical synchronization occurred.

## Corrections

- **F1:** Command-specific approved views now retain real discovery candidates,
  OpenAPI operations and nested schema/field paging, session filenames and saved
  resource HTTP endpoints. Readable/debug output share the bounded allowlist;
  counters alone cannot establish a known empty result. Nested partial coverage
  and cursors remain visible. Arbitrary envelopes, credential/body fields and
  endpoint addresses are not displayed.
- **F2:** Raw/debug output requires an affirmative unquoted directive. Korean and
  English refusals, quoted terms and bare/ambiguous mentions stay readable or
  receive the experimental output-field clarification. Positive raw requests
  continue to work through the approved-field filter.
- **F3:** The host records immutable authoritative turns separately for intent,
  target and output. A correction replaces only named fields. Source-only
  corrections retain raw-output authorization; explicitly replacing output
  removes it. Source literal spans and result provenance refer to their active
  field's authoritative turn, while dispatch/publication still bind the new
  active request, catalog, source and policy revisions. Delayed stale A results
  and cancelled results remain suppressed.
- **F4:** Choice payloads are validated before probability iteration. Missing,
  null, array or nonnumeric probabilities yield `invalid_decision`. Standard
  connector permission denial stays `permission_denied`; provider/transient
  failure stays `provider_failure`; the unsupported-operation escape yields
  `unsupported_operation`. Missing metadata and exhausted display budget retain
  their separate outcomes. Denials cause no substitute read, enqueue or result
  publication.
- **F5:** A saved HTTP endpoint with `connected:false` is described as
  `설정 저장됨, 연결 안 됨`, with saved configuration still distinguished from
  verified current authentication, permission and health.

The ADR's prepublication clarification was written before product fixes. These
changes implement existing accepted requirements; they add no general parser,
hidden LLM or broader decision-engine rewrite.

## Evidence and checks

[Revision evidence](jev-request-understanding-revision-results.json) records the
observed original corpus, ten reviewer probes and twenty supplemental
regressions separately.

- Failure first: all **10/10 unchanged reviewer probes failed** on `ac5feca`
  before product changes. Original reviewer stimuli/assertions remain in the
  new regression file; observation output is now opt-in and two positive saved
  connection wording assertions strengthen F5. Supplemental failure-kind probes
  also reproduced denial/provider/transient misclassification before that fix.
- Corrected focused checks: **85/85 tests in four files pass**, including all
  ten reviewer probes and twenty supplemental regressions.
- Original evaluation: **24/24 cases pass**, ten useful answers, 13 scoped
  metadata dispatches, 41 scripted evaluator phases, zero forbidden calls and
  zero generated-model calls. The 24 fixture records and their SHA-256
  `e3581b246342189a4d670281b20af4bb6a8e889c44bca133fe85ce3794627dc3`
  are unchanged. The old tracked result artifact remains historical evidence.
- Full prior regression scope plus the new file: **517/517 tests in 58 files**
  pass (487 original tests plus 30 review regressions).
- Core production and test TypeScript checks pass. Eight dependency/webhook
  security checks pass using only synthetic loopback delivery. Architecture
  checks pass across 1,299 modules / 4,840 dependencies. `git diff --check` passes.

Working logs and full JSON reports are local under
`build-evidence/jev-request-understanding-revision/`; the existing offline runner
also refreshes `build-evidence/jev-request-understanding/summary.json`.

## Files changed from ac5feca

1. `docs/architecture/jev-request-understanding.md` — pre-code clarification.
2. `docs/research/jev-request-understanding-checkpoint.md` — historical pointer.
3. `docs/research/jev-request-understanding-revision.md` — this handoff.
4. `docs/research/jev-request-understanding-revision-results.json` — actual evidence.
5. `packages/core/src/contracts/request-understanding.ts` — field provenance and
   the unsupported-operation terminal outcome.
6. `packages/core/src/intelligence/decision/request-understanding/session.ts` —
   field authority retention, replacement and permit validation.
7. `packages/core/src/intelligence/decision/request-understanding/session.test.ts`
   — existing permit fixtures supply the new provenance contract.
8. `packages/core/src/intelligence/agent/commands/chat/metadata-output.ts` —
   approved producer-specific views and affirmative raw syntax gate.
9. `packages/core/src/intelligence/agent/commands/chat/request-understanding.ts` —
   field-bound authorization, runtime answer validation and typed failure mapping.
10. `packages/core/src/intelligence/agent/commands/chat/result.ts` — saved but
    disconnected HTTP wording.
11. `packages/core/src/intelligence/agent/commands/chat/request-understanding.review.test.ts`
    — ten reviewer repros and twenty separately reported regressions.

## Reproduction

From the repository root, use the existing copied dependencies; no installation
is needed. Both type checks and static/security checks use the prior commands:

```powershell
node node_modules/typescript/bin/tsc --noEmit -p packages/core/tsconfig.json
node node_modules/typescript/bin/tsc --noEmit -p packages/core/tsconfig.test.json
node --test scripts/dependency-security.test.mjs test/manual/webhook.test.mjs
node node_modules/dependency-cruiser/bin/dependency-cruise.mjs packages/core/src --config .dependency-cruiser.cjs --output-type err
node scripts/verification/request-understanding-offline.mjs
```

From `packages/core`, set `AX_DB_BACKEND=sqljs` and `AX_DATA_ROOT` to a task-local
scratch directory. The new file works without observation-file output; set
`AX_JEV_REVIEW_EVIDENCE=1` only when collecting observations in that scratch root.
Keep both live-study flags empty.

```powershell
node node_modules/vitest/vitest.mjs run src/intelligence/agent/commands/chat/request-understanding.review.test.ts --configLoader=native --maxWorkers=2
node node_modules/vitest/vitest.mjs run src/intelligence/agent/commands/chat src/intelligence/agent/commands/service src/intelligence/decision/request-anchor.test.ts src/intelligence/decision/request-understanding src/intelligence/decision/read-controller/controller.test.ts src/testing/north-star/plain-chat-safety.test.ts --configLoader=native --maxWorkers=2 --exclude '**/*live*.test.ts'
```

## Limits and next gate

No environment/approval blocker remains for this offline revision. Independent
exact-commit rereview is the remaining publication gate. The optional seam still
has no Desktop producer or production `SourceMetadataEvidence` adapter; the
existing read controller remains unwired. The legacy multi-tool voting and broad
workflow semantic/value-review gaps are not rewritten. Transports that ignore
abort cannot be forcibly stopped by these publication guards.

No live baseline/candidate comparison was run, and no Korean comprehension,
calibration, latency or cost gain is claimed. All choices are scripted and all
data are synthetic. The live ledger remains 27/30. A future live study still
requires explicit additional permission, a pinned model/corpus/scorer and actual
transport/byte/cost budget for the one predeclared question/context package
contrast. The screenshot causal trace remains unproven.
