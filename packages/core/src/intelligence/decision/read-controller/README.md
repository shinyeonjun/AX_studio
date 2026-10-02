# Ephemeral Jev read/evidence controller, v1

This is a **synthetic-tested, unwired core**, not a replacement for live chat,
runtime investigation, saved workflows, or the hybrid PDF report planner. It has
no production callsite and no top-level core export. Import its `index.ts` only
when introducing an explicitly gated integration. No persisted workflow, binding,
or report checkpoint meaning changes here.

## Authority boundary

- The host verifies and freezes the full accepted `AuthoritativeRequestAnchor`.
  Every evaluation contains its exact `text`, digest and original provenance.
  Request overflow, anchor/session/revision mismatch and decision-packet overflow
  terminate before evaluation or reads; no excerpt replaces authority.
- The host supplies the already-authorized source/connection scope and immutable
  coverage requirements. Candidate discovery cannot add a source. Determining
  those scopes/requirements from the authoritative request remains an integration
  responsibility; this core does not parse natural-language authorization.
- Host operations must be `read`, `NONE`, and `inspect`. Write/report/export/send
  operation names are refused even if mislabeled. HTTP operations require GET or
  HEAD. External-DB operations additionally require an explicit read-only host
  contract. That declaration is **not a SQL sandbox**: any future DB adapter must
  use AX's validated read-only connector/transaction path, SQL allowlist, resource
  policy and scalar-precision gates. This patch adds no DB connector or SQL builder.
- Exact query spans, body references and paging tokens require host-held refs.
  Models never supply a raw query, ID, cursor, SQL, parameter object or JSONPath.
  Paging refs can only enter a continuation derived from the successful parent;
  they cannot be rebound to a different query. Fixed typed defaults stay local.
- Call IDs are opaque random host IDs, distinct from operation IDs. Refs include
  source, connection, session, catalog/policy revision, originating call,
  result digest and snapshot digest. Unknown, stale, wrong-contract and
  cross-source refs fail before execution. The execution boundary rechecks refs
  and real permissions/revisions, including a second check before publication.
- Trusted adapters explicitly supply policy-permitted decision views. There is no
  raw-data-as-preview fallback. Raw authorized results remain local and are
  returned only to the host at accepted finish. External data is evidence, never
  executable instruction or source authorization.

## Concrete next integration seam

At the existing single-read branch of `chat/loop.ts`, introduce a narrow opt-in:

1. Pass the exact accepted request anchor, a matching session/catalog snapshot,
   a policy-context revision and the scoped read operations. Scope must remain
   inside the user's named sources and current body/metadata policy.
2. `discover` registers exact host-found request spans and scoped candidates using
   `offerSearchSpan`. After joined results, it may call `registry.continue` or
   `registry.retry`, or offer one of `registry.observedRefs()` through
   `offerGmailBody`. It must not call a connector itself or use model-generated
   arguments. Helpers are idempotent for the same host offer; successful reads
   never become eligible again.
3. `decide` delegates the provided closed choice questions to the configured Jev
   `DecisionEngine.evaluate`, carrying the controller signal. No command-model or
   structured-LLM fallback is allowed. Missing, invalid, tied or low-confidence
   answers return clarification. The `next` choice is read/continue/retry/finish/
   clarify; per-instance yes/no questions permit independent joined reads.
4. `authorize` uses the real current design-tool/source policy and returns the
   current catalog and policy revisions. Denied body scope must not be replaced
   by a broader account, source, operation or cloud-data policy.
5. `executeRead` maps the fixed instance to `executeScopedChatCommand` and retains
   the service's exact capability+params read authorization. The Gmail body
   specification uses `params.message`, accepted by the existing connector's
   `resolveGmailMessageId`; live catalog/service IO compatibility must be proven
   before enabling this adapter. Normalize the JSON envelope after its existing
   result limits, cancellation and data-policy gates.
6. Only `outcome.status === 'finished'` permits existing `runText` prose/rendering,
   with the selected permitted evidence views and host coverage limitations.
   Clarify/cancelled outcomes never invoke synthesis as if the task succeeded.
   Preserve existing raw/table rendering and `onReadResult` behavior separately.
7. Add real `runAxCommandChat` + `AxCommandService` + scripted Jev + fake connector
   tests before enabling the gate. This patch's direct helper tests are not that
   production integration evidence. Label the route "Jev-controlled read task"
   and retain the PDF route's separate "hybrid planning" label.

Next consumers are runtime investigation and then report source/evidence stages;
saved graph bindings and report expression/layout planning remain unchanged.

## Budgets and provider dispatches

Defaults are 8 total read attempts including retries, 12 evaluator phases,
concurrency 2, one transient retry, a 120-second task deadline and a 65,536-byte
host decision packet. These are safety bounds, not evidence-sufficiency decisions.
They do not enlarge existing connector caps or establish large-DB support.

`providerBudget` makes HTTP enforcement explicit:

- `dispatch-guard`: every actual decision-provider **and** connector-provider call,
  including internal batching/retries/header fan-out, must go through the shared
  `context.budget.dispatch(serializedRequestBytes, context.signal, send)` at its
  transport dispatch point. Reservations happen before `send` and consume shared
  count/byte bounds even for failures/cancellations. Synthetic tests exercise an
  evaluator making multiple provider dispatches in one evaluation and prove the
  third callback never sends when the cap is two.
- `external`: the host must state why the actual HTTP cap is enforced elsewhere
  or outside this slice. The returned `providerEnforcement` stays `external`.
  `providerDispatches` records wrapped reservations only and is not evidence of
  unwrapped HTTP calls. Evaluator-phase count is never a hard HTTP-call cap.

The existing Jev adapter can internally split a packet into multiple HTTP bodies.
This core neither modifies that adapter nor claims its host-packet ceiling is
the provider's final serialized body size. Live wiring must wrap its actual fetch
dispatch or declare enforcement external; post-response provider telemetry alone
does not enforce a cap. SDK response-byte limits and underlying transport abort
support also remain required in the host adapters.

## Coverage and cancellation

Each result's upstream completeness, decision-view omissions, refs, pagination
and estimates are validated and published in one atomic joined-batch commit.
Empty pages with a next cursor are eligible to continue. Consumed cursor cycles,
duplicate effective reads in one batch, successful duplicates and repeated
unsupported decisions stop deterministically. Only typed transient failures can
retry the same fixed parameters and provenance; denials and generic throws cannot.

Original per-page completeness is never relabeled. A terminal continuation does
not make Gmail/Slack query history complete. Only an adapter with an explicit
stable full-traversal guarantee may set `completeOnExhaustion`; these shipped
Gmail/Slack specs do not. Aggregate counts never use provider estimates; exact
totals require a complete single host stream and explicit count metadata. Multiple
possibly overlapping queries cannot establish an exact union count here. A
`complete` requirement also requires an unomitted decision view. An `observed`
requirement allows Jev to finish a sufficient bounded sample while disclosing its
partial/estimated coverage.

The controller owns a linked task signal and deadline. It checks before/after
every async boundary, aborts queued work on termination and clears its private
registry in `finally`. Read jobs keep scratch results private until the join.
Late callback results after abort cannot publish refs/evidence, start another
call, return raw data or produce a successful finish. Adapters must still honor
the signal to stop their underlying transport; ignored aborts cannot be forcibly
stopped by this connector-neutral core.

## Adapter coverage and verification

The new adapters are pure normalizers/specifications over the existing JSON
envelopes, with no network or connector client imports:

- Gmail search and exact returned message-ref body reads
- Slack cursor-based search, including empty filtered pages
- Slack page-number fallback/provider page-limit results deliberately fail closed
  with `slack_page_mode_not_supported`. History `nextLatest`, page-number mode,
  streaming source reads and DB scalar/query adapters are future work

Synthetic tests cover repeated searches, observed-ref selection, pagination and
finish, forged/stale/cross-source refs, body denials/revision changes, malformed/
tied/missing/no-progress decisions, retries/shared caps, cursor cycles, terminal
partial pages, preview omissions, guarded provider batching, packet/request
overflow, cancellation during decision/policy/parallel reads and late results.
They use no credentials, live API, paid model, user data, production DB or network.

Run the focused suite with the core workspace's existing Vitest installation:

`vitest run src/intelligence/decision/read-controller/controller.test.ts --maxWorkers=1`

This slice depends on the exact-request patch's new
`contracts/request-anchor.ts` and `decision/request-anchor.ts`; integrate that
patch first. No source edits outside this new directory are included here.
