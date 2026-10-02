# Second prepublication correction checkpoint

The independently reviewed candidate
`487f8ea37363128cc05be91b8c06049092c098d8` and the original `ac5feca` remain
unchanged in Git history. The second independent report requested **REVISE**.
This bounded correction implements R1–R4. The exact corrected hash is supplied
in the handoff; publication remains held for independent rereview of that commit.

## Four corrections

- **R1: complete affirmative raw directive.** The syntax gate recognizes one
  unquoted JSON-format assertion with a complete affirmative directive and
  ending. It checks the full continuation, retains quoted text as context rather
  than deleting a trailing qualification, and accepts finite Korean/English
  directive frames. Unknown continuations stay readable or receive the optional
  seam's output clarification. This replaces permissive verb-prefix matching;
  no individual refusal string is added for the three new probes. Real legacy
  chat/service tests cover those refusals and genuine affirmative raw controls.
- **R2: current-page facts.** An empty page with positive or unknown total, or
  incomplete coverage, says the current page has no displayed items. Only a
  supplied zero total with no incomplete flag produces the known-empty message.
  Known totals, partial coverage and cursors remain visible; unknown envelopes
  still receive the format clarification.
- **R3: registered capability contract.** Parameter identifiers and their
  supplied required/optional flags are readable. Named I/O contracts are
  retained in both readable and approved raw output. The bounded view keeps at
  most 32 ports per direction with bounded names, and validates values against
  the existing `ContractTypeNameSchema`; unknown values are omitted with partial
  disclosure. Real `capability.describe('rdb.query.read')` displays required
  `table`, optional `offset`/`limit`, and `outputs.rows: TableArtifact`. Describing
  this registered contract does not invoke the DB query or retrieve rows.
- **R4: residual unsupported goal.** The reply quotes the exact active intent
  authority, with its request revision. An older source mention is explicitly
  historical; the currently selected registered B target appears separately.
  Explicit intent replacement changes the quoted goal. The result remains
  `unsupported_intent`, with no service dispatch or generated-model call and no
  claim of goal completion. No semantic goal extraction or old permit is used.

The ADR clarification was written before product fixes. These changes introduce
no general language parser, extra decision phase, Desktop activation or broader
engine rewrite.

## Evidence and exact checks

[Second-revision evidence](jev-request-understanding-second-revision-results.json)
keeps the original corpus, prior review suite and new review suite distinct.

- Before product fixes, the **eight unchanged reviewer probes reproduced seven
  failures and one passing zero-match control** on `487f8ea`. The read-only
  reviewer fixture is untouched; its SHA-256 is
  `d41e82541af246a1e7bd586c09a5fd080d7adca176adf3a68fb8f61d9ef85a69`.
  The checked-in copy retains all eight original stimuli/assertions, makes
  observation writing opt-in, and adds current-target/provenance/non-completion
  assertions to the unsupported correction probe.
- Corrected new suite: **16/16 tests pass** — eight reviewer probes, including
  the zero-match control, plus eight supplemental tests. These are outside the
  original 24-case evaluation. The prior thirty review regressions still pass.
- Focused integration/renderer/session scope: **101/101 tests in five files**.
- Full previously checked scope plus the new file: **533/533 tests in 59 files**
  (517 prior tests plus sixteen new tests).
- Original evaluation remains **24/24**, ten useful-answer cases, 13 metadata
  dispatches and 41 scripted evaluator phases. Forbidden and generated-model
  calls remain zero. Original fixture SHA-256 remains
  `e3581b246342189a4d670281b20af4bb6a8e889c44bca133fe85ce3794627dc3`.
- Core production and test TypeScript checks pass. The eight dependency/webhook
  security tests pass using synthetic loopback delivery. Architecture checks
  pass across 1,300 modules / 4,857 dependencies. `git diff --check` passes.

Full working reports are in
`build-evidence/jev-request-understanding-rerevision/`. Reproduction uses the
previous checkpoint's commands, the existing copied dependencies, `sqljs` and a
task-local scratch root. The new file is
`src/intelligence/agent/commands/chat/request-understanding.rereview.test.ts`
from `packages/core`; observation writing additionally requires
`AX_JEV_REREVIEW_EVIDENCE=1`. Keep the live-study flags empty. The unchanged
offline runner remains `node scripts/verification/request-understanding-offline.mjs`.

## Seven changed files from 487f8ea

1. `docs/architecture/jev-request-understanding.md` — pre-code clarification.
2. `docs/research/jev-request-understanding-revision.md` — historical pointer.
3. `docs/research/jev-request-understanding-second-revision.md` — this checkpoint.
4. `docs/research/jev-request-understanding-second-revision-results.json` — actual
   corpus/review evidence and checks.
5. `packages/core/src/intelligence/agent/commands/chat/metadata-output.ts` —
   affirmative-format grammar, page facts and approved capability contract view.
6. `packages/core/src/intelligence/agent/commands/chat/request-understanding.ts` —
   field-bound unsupported goal and current target display.
7. `packages/core/src/intelligence/agent/commands/chat/request-understanding.rereview.test.ts`
   — eight reviewer probes and eight supplemental regressions.

## Scope and next gate

No environment or approval blocker remains for this offline correction. The next
gate is independent exact-commit rereview before any publication. The optional
seam still has no Desktop producer or production `SourceMetadataEvidence`
adapter. The existing read controller remains unwired. Legacy multi-tool voting
and broad workflow semantic/value review are unchanged. No canonical workspace,
UI-worker file or application process was changed.

All choices/data are scripted/synthetic. No live model comparison, Korean
comprehension gain, calibration, latency or cost improvement is claimed. No
provider call, installer, private data access or push occurred; the live ledger
remains 27/30. A future live study still needs explicit permission and pinned
model/corpus/scorer/transport-byte-cost budget for the single registered package
contrast. The screenshot causal trace remains unproven.
