# Accepted ADR: fenced Desktop plumbing for registered HTTP metadata

Status: revision 2 independently accepted before implementation. The parent authorizes the default-off offline implementation slice; no live activation is authorized by this document.
Source baseline: PR 158 `63d7c60425d5be3fc6808487909ec41c8803ce55`, compared with main `aa093579ff2dde6c8c7e1e11805a82f3aaa7c52d` on 2026-10-02. The Desktop/catalog/store files discussed below are identical at these two commits. Recheck their integration ancestry before implementation.

## Decision

Build one default-off production plumbing slice: an explicit Desktop metadata lane over **saved HTTP endpoint registrations**. Reuse the accepted Jev finite-field evaluator and single-use permits. Supply real store-backed catalog/evidence adapters, a real main-process request-generation owner, and fenced answer publication. Run the entire path offline with a scripted transport. Do not change ordinary chat routing or activate a live model/provider.

Supported facts are registered HTTP inventory, user-maintained field dictionaries, and saved connection configuration. OpenAPI, dynamic capability schemas, RDB describe, folder/file enumeration, body retrieval, workflow actions and automatic natural-language routing are deferred. This narrower scope directly exercises the category-list problem without claiming an all-domain integration.

### Why another boundary is necessary

- `workspace-chat-command-handlers/chat.ts` supplies `requestId`, session ID and an AbortSignal but never creates `requestUnderstanding`. `workspace-chat-registry.ts` cancels a duplicate request ID; a different request ID in the same session does not supersede it.
- `chat-boundary.ts::selectMessagesThroughUserMessage` identifies a persisted turn by text. Repeated identical messages have no exact turn identity. `message-actions.ts` appends and saves the final answer after IPC returns, leaving a publication/persistence race beyond a core dispatch check.
- `WorkflowStore` has `getConnectionRevision()`, incremented by `setConnection`; it has no discovery-metadata revision. Session memo/workflow policy are preference data, not a permission system.
- `discovery.describe` is not uniformly local: a database-table schema request calls `rdb.table.describe`. Existing discovery envelopes also are not `SourceMetadataEvidence`.

Sources: [Desktop handler](https://github.com/shinyeonjun/AX_studio/blob/aa093579ff2dde6c8c7e1e11805a82f3aaa7c52d/apps/desktop/electron/main/ipc/workspace-chat-command-handlers/chat.ts), [registry](https://github.com/shinyeonjun/AX_studio/blob/aa093579ff2dde6c8c7e1e11805a82f3aaa7c52d/apps/desktop/electron/main/workspace-chat-registry.ts), [store](https://github.com/shinyeonjun/AX_studio/blob/aa093579ff2dde6c8c7e1e11805a82f3aaa7c52d/packages/core/src/persistence/workflow-store.ts), [describe producer](https://github.com/shinyeonjun/AX_studio/blob/aa093579ff2dde6c8c7e1e11805a82f3aaa7c52d/packages/core/src/intelligence/design-tools/tools/discovery.ts).

## 1. Admission and gating

The host option is absent/off by default. The first implementation supports only an internal `offline_test` installation with an explicitly injected evaluator transport; there is no environment-variable-only live enable path or shipped UI activation. Tests call the actual registered IPC handler, not a replacement E2E fake agent.

A bounded explicit lane marker (`registered_http_metadata`) is necessary in addition to that host gate. It is internal research/test admission, not a permanent daily user-facing mode-selection workflow. Ordinary-language activation is deferred. The marker is an untrusted request preference, never permission or a source ID. With no marker, existing general chat/model identity/pending-command/confirmation routing remains unchanged. With the marker but the gate unavailable, answer that this metadata path is unavailable; do not silently send it through executable legacy routing. Pending command/input-confirmation continuations cannot enter this lane.

No extra LLM planner, broad regex intent parser or preliminary live classifier is added. The existing `runRequestUnderstandingChat` remains the sole finite intent/source/output/metadata-operation evaluator. Retrieval/action, uncertain decisions and unavailable metadata terminate inside the lane. They never fall through to another reader or enqueue path. Ordinary chat remains available as a separate normal request.

## 2. Exact Desktop request lifecycle

Add optional stable user `turnId` to the bounded workspace-message contract. `message-actions.ts` already generates a UUID before initial persistence; use that same value as `turnId` and `requestId`. The metadata lane requires an exact persisted `(sessionId, turnId, role=user, text)` match, rather than reverse text matching. Older transcripts remain readable; they cannot become executable metadata continuations merely from matching text.

Introduce a main-process coordinator in `workspace-chat-command-handlers/metadata-turns.ts` (new). It owns monotonically increasing session generations and active `RequestUnderstandingSession` instances. Admission happens when the new user turn is successfully saved, before any asynchronous evaluation. Any new real user turn in that session, including an ordinary-chat turn, invalidates older metadata work. A repeated request ID is rejected or recognized as already active; it never dispatches twice.

Pass the host generation into the core session as its initial request revision through a narrow constructor addition. A new free-text turn starts fresh finite-field assessment and carries no old permit, selected source, raw-output permission or inferred intent. Cancel A before starting B. A fragment such as “아니, B” may require a specific clarification about B's metadata goal; it cannot reuse A's answer or authority. Partial-field inheritance and a host-rendered supersedes-mask producer are explicitly deferred. Existing core correction tests remain regression tests, not evidence that Desktop supports the full correction UX.

Wire request cancel, session delete and shutdown to this owner alongside the existing registry. Check generation/signal and current source-policy revisions before evaluation, metadata dispatch, approved-result callbacks, progress publication and final reply. A slow adapter/transport that ignores abort cannot publish after invalidation.

For this lane, main owns the final assistant-message append: re-read the current transcript, check the exact active generation, and synchronously append the approved reply through a store method. Return a typed persisted-reply receipt. The renderer must check request/session identity and **must not re-save its old full transcript** for such replies. A final check in `runAxCommandChat` alone is insufficient. Failed/stale publication returns cancellation/conflict, never a successful metadata answer.

Protect this append from **every overlapping transcript writer**, not only metadata replies. The store owns a per-session transcript revision, distinct from request generation. Reads/save receipts carry the revision; every committed transcript mutation, including trusted execution-result appends, advances it. Once a session participates in the metadata slice, every whole-transcript replacement must atomically compare an expected revision with current state before writing. This applies to ordinary-chat final saves, metadata saves and initial user-turn snapshot saves; a missing/stale revision is rejected without mutation. Mark first participation and validate/write its first user turn in the same synchronous store boundary, so an older writer cannot race through registration. Main's metadata append reads the current revision and checks it together with the active generation at commit.

Thread revision tokens through existing renderer persistence calls without changing general routing. On conflict, reload the authoritative transcript, preserve any unsaved new user text for review, and do not blindly retry an old full snapshot or re-execute a command. An old ordinary request A must not erase metadata B or a newer user turn when A eventually saves. Use a process-scoped revision owner for the existing single-main-store model; old tokens are invalid after restart. Sessions never participating in the slice need no new routing or UX. Extend the existing delayed-reply race fixture rather than introducing a separate history architecture or database migration.

## 3. Real local metadata adapter and honest facts

Add `service/registered-http-metadata.ts` (new), exposing a host catalog snapshot and local describe function. Read `store.getConnections()`, `parseHttpEndpoints(http.config)`, and `store.getDiscoveryMetadata('http:' + endpoint.id)`. Do not use `httpEndpointsFromConnections` as the sole catalog producer because it removes disabled saved endpoints. Reuse validated parser identities and the existing `http:<id>` asset convention. Never use `matchHttpEndpoint` default selection.

Project safe fields immediately; raw configs, auth headers/usernames/secrets, base-URL queries and free-form error bodies never reach the evaluator, approved evidence, logs or raw/debug reply. Do not call `discoverHttpReadOperations`: that function performs a root-URL GET. Saved `discoveredReadOperations` are the only inventory producer.

Operation-path safety is a separate allowlist before any model/output/log projection. The existing `connection/parse.ts::parseDiscoveredReadOperations` rejects literal query/fragment delimiters, leading `/`, `//`, backslashes and encoded slash/backslash, but its character set permits `:` and `@`; therefore it does **not** alone prove exclusion of credential/userinfo-bearing references. The metadata adapter must additionally reject URI schemes, authority/userinfo forms and any `@`, `?`, `#` or control-character-bearing operation reference. Validate a bounded decoded view to reject encoded equivalents; malformed or ambiguously nested encodings fail closed. Validation must never normalize, strip a credential/query/fragment and then return a different identity. Drop the entire unsafe operation and its associated label from candidates/evidence, report filtered coverage without echoing the value, and produce only a generic non-sensitive diagnostic. Safe accepted paths retain their exact stored identity. This is a bounded syntax gate, not a claim that arbitrary strings can be proven secret-free.

- Inventory: emit the persisted validated operation labels and relative paths. Undefined discovery means unavailable metadata. An explicitly stored empty list means no registered advertised links, not an empty remote API. A capped or filtered stored list cannot establish full upstream coverage. Never turn four registered paths into a claim about all of DummyJSON.
- Schema: emit only the selected endpoint's persisted `DiscoveryMetadataRecord.fields`, labelled “registered field dictionary”. An absent dictionary means unavailable schema; generic `http.request` parameters are not that endpoint's data schema. Missing types/required flags remain unknown. No record sampling or live describe is allowed.
- Status: `catalogExists` and `configured` follow the actual saved registration. Display the stored enabled/disabled bit separately. Authentication, remote operation permission and health remain `unknown`; `authStored`, `connected`, `authReady` and catalog availability are not current verification.

Use a small reviewed evidence-contract extension for exact relative paths up to the existing parser's 512-character limit, optional field type/required values, and the stored enabled bit. Do not truncate identities into another identity. Host-local evidence-entry refs may index the revision-bound snapshot, but are never presented as remote operation IDs. Keep the existing 32 KiB result budget, 32-source candidate bound, 64-entry/field output bounds, exact known-total scope and explicit truncation. Counts describe the validated local registration view only. Reject corrupt/oversized identities conservatively; filtered or capped input cannot be labelled complete.

In `AxCommandService.execute`, a recognized local-metadata permit selects this adapter **before** normal `executeCommand` dispatch. Extend the private permit record/claim result with the accepted intent, source identity and revision-bound adapter descriptor; do not accept these as renderer or model-supplied authority. Only the exact registered `discovery.describe` command for that HTTP source is admitted. No normal read gateway, connector, RDB, SQL, network or workflow fallback runs. Unpermitted legacy commands keep their existing behavior. Unsupported permit adapter kinds fail closed.

## 4. Current revisions and permission meaning

Add `WorkflowStore.getDiscoveryMetadataRevision()`, advancing only after successful upsert/delete mutations; retain `getConnectionRevision()`. Catalog snapshots synchronously pair the two counters with the projected store state. The main coordinator maintains a monotonic catalog generation; conservatively advancing every source revision on either change is acceptable for this small slice.

`policyRevision` is explicitly the **local metadata admission policy epoch**, advanced when the installed mode/eligibility changes. It is not an OAuth scope revision. `allowed` means the existing authorized host may inspect this local metadata view in the current session. External permission remains unknown and no external operation is offered. Session memo/workflow policy must not create permission. If future source-specific visibility rules exist, their real producer must be bound before adding those sources.

The service and final publisher obtain fresh store counters and gate/session state, not a callback closing over the initial connection snapshot. A mismatch invalidates the permit/result, advances/replaces the catalog and requires a new request; do not silently reuse the judgment. Verify all in-scope writers use the same main-process store. Process restart drops every ephemeral request and permit. Cross-process database writers and mutable external permission grants are outside this offline/local slice, not covered by fictitious revision integers.

## 5. Exact change map and acceptance

Existing files to modify only after review:

- Core: `contracts/request-understanding.ts`; `intelligence/decision/request-understanding/session.ts`; `intelligence/agent/commands/service.ts` and `service/contracts.ts`; `chat/metadata-output.ts`; `persistence/workflow-store.ts`; `persistence/repositories/workspace-chat/contracts.ts` and its transcript mutation/host-append helpers, including the common revision/CAS fence
- Core public API: narrow exports through `intelligence/decision/index.ts` and `contracts/index.ts` as necessary; do not export/wire the broader read controller
- Desktop: `ipc/workspace-chat-command-handlers/chat.ts`; `workspace-chat-registry.ts`; `ipc/workspace-chat-persistence-handlers.ts`; `ipc/chat-boundary.ts`; `ipc/workspace-chat-command-handlers/controls.ts`; `electron/preload/index.ts`; renderer `features/chat/hooks/workspace-chat/message-actions.ts` and its response contracts/API types
- New small owners: core `service/registered-http-metadata.ts`; Desktop `workspace-chat-command-handlers/metadata-turns.ts`; colocated focused tests

Run tests through the real trusted IPC wrapper, in-memory real database/WorkflowStore, real AxCommandService, new real metadata adapter, existing RequestUnderstandingSession and existing JevDecisionEngine with injected scripted `fetch`. Do not mock the service/evidence adapter or take the E2E fake-agent branch. Stub external network/connector/body/queue/prose calls to fail if reached. Use the existing common scripted library where compatible; fixtures below are integration additions, not new model-quality cases.

| Case | Required observation |
| --- | --- |
| Gate off / ordinary chat | No understanding evaluations; existing general-chat behavior and pending-command controls unchanged |
| Saved HTTP inventory | Exact fixture labels/paths and local-coverage limitation; zero body/API/queue/prose calls |
| Missing vs empty discovery | Different useful replies; neither asserts remote emptiness or triggers discovery |
| Registered schema / absent fields | Real dictionary facts with unknown types preserved, or specific unavailable-schema reply |
| Disabled saved endpoint | Remains a status candidate; saved enabled bit visible, all current remote verification unknown |
| Duplicate label / overflow / malformed config | No default source; specific ambiguity/incomplete/unavailable outcome, honest coverage |
| Retrieval/action / malformed or uncertain Jev | Terminal typed reason; no legacy executable fallback |
| A delayed, then B with new ID | A aborts before B; late A callbacks, reply and persistence rejected; fully specified B alone answers |
| A then “아니, B” | A invalidated; B clarification allowed; partial-field inheritance reported unsupported in this slice |
| Cancel/delete/shutdown or connection/dictionary/policy change | No subsequent dispatch or publication from old generation, even if underlying promise resolves |
| Repeated identical text / delayed renderer reply | Extend the existing race fixture: exact turn IDs distinguish requests; ordinary A starts, metadata B persists, then late A's full-transcript save is rejected. Also reject a stale initial user-turn snapshot save. Current B/new turns and background results remain intact, with no duplicate or lost turns; missing-revision saves cannot bypass the fence |
| Raw refusal/adversarial metadata / forged or replayed permit | Approved fields only, inert rendering, affirmative raw gate, single-use exact scope preserved |
| Credential-bearing saved operation reference | Fixture includes `user:password@host/orders`, query/fragment-bearing paths and encoded variants with synthetic secret markers. Reject entire entries before projection; assert markers and associated labels are absent from evaluator state, approved/readable/raw output and diagnostics, while a safe sibling remains useful and filtered coverage is explicit |

Acceptance requires positive facts for resolvable cases, not merely no forbidden calls. Run PR158's unchanged 24-case offline gate and existing affected Core/Desktop suites plus typecheck/build/architecture gates on the final integrated commit. Report actual results separately; none were run for this ADR. Prior 24 cases/533 regressions and CI are baseline evidence, not proof of this proposal.

## Alternatives, risks, rollback and later experiment

Unconditionally passing `requestUnderstanding` is rejected: it intercepts ordinary chat and can inherit live describe behavior. Reusing the generic discovery gateway with only nicer output is rejected because it does not enforce local-only execution. An automatic Jev metadata router could provide broader UX, but adds a semantic routing experiment; defer it. A direct deterministic metadata UI is a useful alternative but would not exercise the judgment harness. Chosen explicit/default-off plumbing costs extra lifecycle code and provides no immediate shipped behavior gain.

Testable hypotheses: real stored metadata can produce useful answers without any data read; generation/revision fences make late results non-publishable and stale writers unable to erase later turns; ordinary routing is unchanged when the lane is absent. Ordinary saves against a metadata-participating session intentionally gain stale-write rejection. Offline success demonstrates these host properties only. Korean understanding, automatic lane choice, full correction usefulness, live credential freshness and speed/cost gains remain unknown.

Rollback: keep the gate off, invalidate all lane generations and remove only the narrow caller/adapter integration if regression occurs. Optional turn IDs remain backwards-compatible; no data migration or destructive cleanup is required. Do not remove unrelated PR158 rendering/safety fixes. No automatic merge, deploy, installer, restart or PC activation is implied.

A later separately authorized live smoke study should use one predeclared paired legacy-tool-vote versus bounded intent/source **question/context package** contrast on frozen synthetic metadata, with identical safety/output and a pinned exact model/corpus/scorer. Start with a small pair proving transport and fact-scoring, not a semantic-gain claim or six-variant experiment. Obtain a fresh explicit actual-dispatch/token/cost cap before any call; the existing ledger remains **27/30 with no extension**.

Instrument the injected transport immediately before each actual `fetch`, including split batches, failures, cancellation and any future retry. Enforce the approved cap atomically across concurrent batches; do not count evaluator phases as requests. Reconcile with existing `providerRequestCount`, `requestBytes` and usage, retaining a transport ledger even when abort errors omit engine counters. Report unavailable token/cost information as unknown, and separate model-only from end-to-end latency. No live Jev call was made for this design.

Design consultation: the original independent ADR reviewer confirmed that fresh-turn invalidation with unresolved B clarification is compatible as an explicitly narrower plumbing slice. The complete revision 2 has now received independent acceptance, obtained by the parent before product code; the original consultation alone was not acceptance of the complete ADR.

Revision 2 addresses the independent review's two narrow blockers: all overlapping transcript writers now share a store-level revision fence, and saved operation paths have an explicit pre-projection credential/query/fragment rejection gate with negative fixtures. The lane-marker clarification does not add a product mode-selection requirement. Revision 2 is independently accepted for the default-off offline slice; live activation remains unauthorized.
