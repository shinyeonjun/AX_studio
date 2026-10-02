# Registered HTTP metadata: offline plumbing evaluation

The parent independently accepted complete ADR revision 2 before this implementation. The supplied review artifact SHA-256 is `1c7babac6b5fc5cbb32f37cdf209357a64b36ef94d2c43635657872e2da1ddf2`; it identifies the supplied proposal, before acceptance-status statements were updated. The accepted contract is [the complete ADR](../architecture/registered-http-metadata-desktop.md). Baseline main is `c42548ca0cc572b9eaeb7e0eaf035689f62a5e18`, tree `35c75a4181331747df3e94ccbe0523cd972bbd98`, identical to tested PR158 integration head `ee5fe7dae730b93e19842fdf129526cb60a1fc21`. The previous checkout, feature branch and review evidence are preserved. This file is committed with the ADR before product code.

No checks for this slice have run at design-record time. Previous 24-case/533-test results and CI36980992152 are baseline evidence only. Actual results must be recorded separately after code and final checks. No live transport, extra live budget, production activation, installer, canonical sync or private user data is authorized. The live ledger remains 27/30.

## Interface impact and task-5 overlap

Task-5's unmerged Core `19cfbda` and renderer `df277f0` remain separate. This branch does not cherry-pick them or edit that worker's checkout. The map below was communicated to the parent before modifying shared contracts, mutations or message actions. Reconciliation needs exact combined review, including deletion and draft behavior.

| Shared interface | Narrow change planned here | Reconciliation concern |
| --- | --- | --- |
| Core workspace-chat contracts | Optional stable `turnId`; process-scoped transcript revision on read/save receipts; typed main-persisted metadata reply receipt | Preserve task-5 message fields and deletion contracts; keep old transcripts readable |
| Core workspace-chat mutations and store | One common revision/CAS owner for all whole-transcript writers and trusted result appends; synchronous first participation and host reply append | Preserve deletion guards, background-result authority and idempotency; do not bypass a fence with another writer |
| Desktop persistence IPC | Bounded optional revision/lane preferences; save admission before asynchronous evaluation; cancel owner on deletion | Combine with task-5 deletion before any await/cleanup, never resurrect a deleted session |
| Desktop registry/control/chat IPC | Default-off internal offline installation, exact persisted turn match, generation invalidation and typed persisted receipt | Preserve existing pending-command/confirmation, ordinary chat and request cancellation behavior |
| Preload and workspace API/response types | Optional persistence options and persisted-reply receipt; no product mode selector | Source-compatible optional parameters; renderer preferences carry no authority |
| Renderer message actions | Reuse generated request UUID as `turnId`; capture save revision across awaits; consume matching main receipt without full-transcript re-save; reload on conflict | Preserve task-5 draft, deletion and chat-result view changes; do not retry execution or erase unsaved text |
| Renderer load/context plumbing | Carry authoritative revision tokens across load/refresh and subsequent initial saves | Keep session-switch epochs and recoverable unsaved text; never substitute a newer token for an older snapshot |

The new metadata adapter and generation owner are separate modules. The broader read controller stays unwired. Any supporting load/context edit must remain limited to carrying revision tokens, with its exact diff listed in the implementation checkpoint.

## Frozen acceptance matrix

These are 13 host-integration cases, not additional model-quality cases. Use the actual trusted registered IPC wrapper, real in-memory database/WorkflowStore, real AxCommandService and local adapter, existing RequestUnderstandingSession and JevDecisionEngine with scripted injected fetch. External network, connector/body retrieval, queue/workflow and prose calls must fail if reached. No E2E fake-agent branch or mocked evidence/service is sufficient.

| ID | Fixture and positive requirement | Negative requirement |
| --- | --- | --- |
| HTTP-01 | Gate off and ordinary chat, including existing pending command controls, preserve existing behavior | Zero understanding evaluations; marker with unavailable gate terminates |
| HTTP-02 | Saved inventory retains exact fixture labels/paths and explicitly limits coverage to local registration | Zero body/API/queue/prose calls |
| HTTP-03 | Undefined discovery and explicitly empty saved list produce distinct useful replies | No remote emptiness claim or live discovery |
| HTTP-04 | Persisted field dictionary yields actual fields; absent type/required remain unknown; absent dictionary is specifically unavailable | No generic HTTP request schema or record sampling |
| HTTP-05 | Disabled saved endpoint remains a candidate; stored enabled bit is shown separately | Current authentication, permission and health stay unknown |
| HTTP-06 | Duplicate labels, overflow and malformed config yield ambiguity/incomplete/unavailable outcomes and honest coverage | No default endpoint selection |
| HTTP-07 | Retrieval/action, malformed or uncertain decisions stop with typed reasons | No legacy executable fallback |
| HTTP-08 | Delayed A is invalidated before fully specified B; B alone answers and persists | No late A callback, progress, answer or write |
| HTTP-09 | A followed by “아니, B” invalidates A and allows a goal clarification for B | No inherited field/source/output authority; partial inheritance unsupported |
| HTTP-10 | Cancel/delete/shutdown and connection/dictionary/policy changes invalidate old generation, including promises ignoring abort | No subsequent dispatch/publication |
| HTTP-11 | Exact IDs distinguish identical texts; delayed ordinary A cannot erase metadata B, new turns or background results; stale initial saves conflict | Missing revisions and old process tokens cannot bypass CAS; no blind retry or duplicate/lost turns |
| HTTP-12 | Raw refusals and adversarial fields remain inert; affirmative raw gate and exact single-use permit scope are preserved | No forged/replayed permit dispatch or unapproved fields |
| HTTP-13 | Unsafe synthetic credential/query/fragment/encoded operation references and associated labels are removed before projection; safe sibling remains useful with filtered coverage | Synthetic markers absent from evaluator state, evidence/readable/raw output and diagnostics |

Assertions require useful facts in resolvable cases, exact persisted turns and transport/forbidden-call evidence. Variants within a matrix row check its explicit conditions; report the 13 rows separately from test-count totals. Extend existing delayed-reply fixtures for CAS behavior rather than creating a new history architecture. Keep PR158's original 24 fixtures unchanged and run their gate in addition to affected Core/Desktop suites, types, build and architecture. Report unavailable or failed checks honestly; do not use baseline CI as proof of this implementation.

## Boundaries and later permission

Only saved HTTP registration facts and field dictionaries are eligible. Safe relative paths retain exact identity up to 512 characters. Candidates are bounded to 32 sources; output to 64 entries/fields and 32 KiB. Known totals cover the validated local registration view only; filtered/capped views are incomplete. Secrets, unsafe references and their labels are rejected before model/output/log projection.

Request generation, transcript revision and local admission-policy epoch have different purposes. Request generations and permits disappear on restart. Transcript tokens belong to the single main-process store; cross-process writers are outside this slice. Authentication and remote operation permission remain unknown.

The internal marker and explicit injected `offline_test` installation are research admission, with no shipped UI selector or environment-only enable path. No automatic natural-language activation is claimed. Desktop starts each real user turn with fresh finite fields; full correction UX is deferred.

A future live study requires separate parent/user authorization and a fresh atomic actual-dispatch/token/cost cap. The one registered question/context package contrast remains the later experiment, using identical safety/output and pinned model/corpus/scorer. This offline slice neither spends nor extends the existing 27/30 ledger.
