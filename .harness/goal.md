# Current task: report execution hardening

Active goal and evaluator: report-execution-hardening.md.

# Current patch: Codex report structured-output round trip

Repair execution 475c8f75-8a0f-4522-8ae0-0c210e0327dc's provider wire mismatch.
Success: real Codex adapter tests restore encoded records/unions, preserve absent
optional values and real nulls, reject invalid values through original Zod,
and expose bounded diagnostics. Failed cards must use failure styling.
No fixture/gold changes, live external writes, or validation weakening.
Evaluator: adapter regression tests, report/core regression, Core/Desktop
typechecks, Desktop build, and diff check. Live report success is separate.

# Goal: Work Discovery correctness-first completion

Complete Work Discovery so teach-by-example flows are verified end-to-end:
historical output + optional input → observe → source inventory → synthesize/replay → clarify → compile → publish → runtime execution.

## Success criteria
- North-star E2E passes (`packages/core/src/work-discovery/e2e/work-discovery-e2e.test.ts`)
- `compileBlueprintToWorkflow` preserves `fields[].mapping` via `transform.evaluate`
- ALL-pass multi-example replay; truncated aggregate rejection
- Required observation publish gate; scoped clarification
- `inputArtifactIds` consumed via `DiscoverySourceProvider` registry
- `npm run build -w @ax-studio/core` passes
- `npm test -w @ax-studio/core` passes (359+ tests)
- `npm run eval -w @ax-studio/core` passes
- `npx tsc --noEmit -p apps/desktop/tsconfig.json` passes
- `npm run build -w @ax-studio/desktop` passes
- document-engine pytest passes

## Current task: session-scoped document sources

Implement the session context boundary for uploaded documents. A workspace chat
owns source references; the artifact store owns immutable input files and
Docling ingest results; the agent receives only bounded source metadata and can
read a ready source through a host command using its session/source id.

### Success criteria

- A workspace chat can attach a local PDF without putting the binary or an absolute path in the transcript.
- The source is persisted under the chat session with an id, status, artifact reference, and Docling summary.
- Existing PDF imports used by Work Discovery continue to ingest through the configured document engine.
- The agent command context contains the current session's source manifest and can read a ready source through a bounded session-source command.
- A source from one chat cannot be read through another chat's session id.
- A failed ingest is persisted as a structured source failure instead of being reported as ready.
- Core tests and desktop typecheck/build pass; no external connector side effects are used by tests.

### Non-goals for this slice

- Promoting a session source into a recurring workflow binding.
- Full source-panel visual redesign; this slice only adds the minimal 자료/흐름 context toggle.
- Background job durability across process crashes; the first slice keeps ingest host-owned and status-persisted.
- General Gmail/Slack artifact ingestion.

### Final checkpoint (2026-08-24)

- Session source repository/service, Docling artifact manifest, bounded agent commands, Electron IPC/preload, and the right-side 자료 panel are implemented.
- Verified with core 88 files/365 tests, targeted session-source tests 5 files/16 tests, core eval 11/11, document-engine 17 tests with 2 pypdf skips, core/desktop typecheck, production build, and diff check.
- Added a host-side guard that prevents chat submission while a session PDF is still being ingested; the latest desktop typecheck and production build pass.

## Current task: Electron E2E test automation

Add a reproducible E2E suite under `test` that exercises the real Electron
main/preload/renderer boundary with isolated temporary data and deterministic
test-only seams. The suite must cover the session-source flow end to end
without invoking real Gmail, Slack, Codex, Claude, or external network side effects.

### Success criteria

- `npm run test:e2e` builds the desktop app and runs the Electron Playwright suite.
- Each E2E test launches an isolated Electron data root and cleans it up.
- The suite covers new chat creation, source attachment, Docling-ready source display, source reload, session isolation, failed ingest display, chat/source deletion cleanup, and UI busy-state behavior.
- Test-only IPC/fake-agent seams are impossible to use unless `AX_E2E=1`.
- Existing Core tests, desktop typecheck/build, and document-engine tests remain green.
- The E2E suite never sends real Gmail/Slack messages or calls real AI providers.

### Non-goals for this slice

- Replacing unit/integration tests with UI tests.
- Real-provider smoke tests against Gmail, Slack, Codex, Claude, or Ollama.
- OS-level automation of native Electron dialogs; the E2E harness uses a gated host seam for deterministic file attachment.

### Baseline (2026-08-24T19:55:48.7424524+09:00)

- `npm run test:e2e`: unavailable; package script and `test/` folder did not exist.
- `npx tsc -p test/tsconfig.json --noEmit`: unavailable; E2E TypeScript config did not exist.
- Core: 88 files/365 tests passed.
- Desktop typecheck and production build passed.

## Non-goals
- Schema drift auto-repair (fixture only)
- Agent semantic synthesis harness (deferred; deterministic path first)

## Current task: PR #117 correctness repair

Close the published Work Discovery runtime seams exposed during review before
merging the PR. The compiled workflow must retain enough session identity for
repair replay, RDB reads must satisfy transform evaluation's table contract,
and expressions that reference multiple sources must receive every bound
snapshot at runtime.

### Success criteria

- A compiled Discovery workflow document retains its source session id.
- A compiled RDB source binds its declared `rows` output to transform evaluation.
- Raw RDB row arrays are normalized at the transform boundary without changing
  the existing RDB connector result contract.
- Multi-source transform expressions receive and evaluate all source snapshots.
- Focused regression tests fail on the pre-fix behavior and pass after the fix.
- The frozen repository evaluator and PR CI pass after the branch is rebased on
  the latest `main`.

### Non-goals

- Changing the public RDB query result shape.
- Reworking repair proposal persistence or unrelated connector behavior.
- Phases 9–10 drift/repair productization

## Current task: HTTP, Webhook, and RDB connector completion

Complete the minimum production path for outbound HTTP/REST, inbound Webhook,
and read-only RDB connectors. PostgreSQL and MySQL must be real integration
targets; SQLite must retain its existing read-only behavior. Add deterministic
local HTTP/Webhook servers and container-backed PostgreSQL/MySQL tests under
`test/integration` without using external APIs or user credentials.

### Success criteria

- HTTP request and connection probe pass against a local Node HTTP server,
  including auth, POST payload, status failure, timeout/redirect policy, and
  base-URL boundary behavior.
- Webhook listener and trigger path pass against a real local TCP port,
  including shared-secret/HMAC auth, path matching, rejection, and downstream
  workflow execution with a test connector.
- RDB supports SQLite, PostgreSQL, and MySQL consistently for probe,
  `schema.describe`, and allowlisted `query.read`.
- PostgreSQL and MySQL integration tests start isolated containers, seed a
  fixture table, execute real reads, and tear containers down.
- Desktop RDB connection validation and settings UI expose MySQL without
  persisting raw credentials in the connection metadata.
- PostgreSQL and MySQL connection strings are stored in the desktop OS
  secret store (`connectionStringStored: true` in metadata).
- Core unit tests cover `rdb/client`, `rdb/config`, and sqlite `RdbConnector`.
- Integration runner executes 6 tests: HTTP (2), Webhook (1), SQLite (1),
  PostgreSQL (1), MySQL (1).
- Existing Core, Desktop, document-engine, and Electron E2E checks remain green.

### Non-goals for this slice

- RDB write queries, migrations, arbitrary SQL, or database-side mutations.
- Outbound Webhook/tunnel automation (tunnel URL remains metadata only).
- OpenAPI dynamic operation generation.
- Real external HTTP services, Slack/Gmail accounts, or user databases.

### Baseline (2026-08-24)

- HTTP mock unit tests exist; no local-server integration runner exists.
- Webhook listener/trigger unit integration exists; no unified connector
  integration runner exists.
- RDB supports SQLite/PostgreSQL only; MySQL dependency, config, connector,
  discovery, and UI support are absent.
- Docker CLI is installed but Docker daemon is not running at baseline.

## Current task: manual REST + PostgreSQL + Gmail/Slack smoke test

Provide a repeatable local fixture that a developer can keep running while
using the real AX Studio app. The fixture must expose a small REST API and a
seeded PostgreSQL database in Docker, print the exact connection values, and
clean up its owned resources when stopped. The manual scenario must combine
RDB read and HTTP write with already-connected Gmail/Slack only after the user
reviews the workflow and accepts the external side effects.

### Success criteria

- `npm run test:manual` starts the local REST fixture and PostgreSQL container,
  prints the REST base URL and PostgreSQL connection string, and remains alive
  for interactive app testing.
- REST fixture supports health, list/read, and JSON create endpoints without
  external network access.
- PostgreSQL fixture contains deterministic `public.customers` seed data and
  is reachable from the desktop app through the printed port.
- Ctrl+C tears down the REST process and only this test's PostgreSQL container,
  volume, and network.
- README gives a concrete AX Studio smoke scenario that reads PostgreSQL,
  filters/uses the result, POSTs to the local REST API, and then sends a
  reviewed message through the user's existing Gmail/Slack connections.
- Existing connector integration, core, desktop, document-engine, and E2E
  checks remain green.

### Non-goals for this slice

- Real external Gmail/Slack test automation without a user review.
- Production REST server, public tunnel, database writes, migrations, or
  arbitrary SQL.
- Replacing the existing automated integration fixtures.

### Baseline (2026-08-24)

- Automated HTTP/PostgreSQL integration is green, but no long-running manual
  fixture or one-command teardown exists.
- Existing Docker integration Compose includes PostgreSQL but also starts the
  MySQL service when used as a whole.

## Current task: Codex command-chat nested JSON failure

Fix the reproducible command-chat failure where a Codex response places
literal line breaks inside the JSON string carried by `argsJson`. The host
must keep the provider-specific wire boundary, preserve command validation,
and return a normal assistant response or a bounded command error instead of
crashing the entire chat turn.

### Success criteria

- A Codex wire command whose `argsJson` contains literal line breaks inside a
  JSON string is normalized safely without executing arbitrary text.
- Valid escaped JSON and existing Codex/Claude/direct transport behavior remain
  unchanged.
- The regression is covered by a focused core test and the relevant core,
  desktop, and build checks remain green.

### Non-goals for this slice

- Changing the command catalog or adding provider-specific business logic.
- Making malformed outer provider responses silently executable.
- Altering connector, workflow, database, or REST behavior.

### Baseline (2026-08-25T00:28:27.4511822+09:00)

- Targeted command/transport/CLI tests: PASS, 23 tests.
- The user-provided failure is consistent with malformed nested `argsJson`
  containing literal newlines in a JSON string; no regression test existed.

## Current task: Agent constitution, soul, and scoped policy context

Implement the layered Agent context boundary agreed in the product design:
`AGENTS.md` supplies stable reasoning and safety rules, `soul.md` supplies
conversation style, session memo supplies temporary confirmed agreements, and
workflow policy supplies durable rules for one saved workflow. The host/runtime
remains authoritative for security, capability contracts, approval, and side
effects.

### Success criteria

- `soul.md` is loaded and embedded through the same build path as `AGENTS.md`.
- Command-chat prompts receive the constitution, soul, current session memo, and
  mapped workflow policy as clearly separated context, without absolute paths or
  connector secrets.
- Session memo and workflow policy have bounded schemas and round-trip through
  the existing SQLite store without breaking old databases or chat records.
- A workflow policy cannot be used to bypass command contracts, runtime gates,
  approval, or data-access boundaries.
- Tests cover context loading, persistence/migration, prompt injection, and
  session/workflow isolation.
- Existing Core tests and production build remain green; any unrelated dirty
  worktree type errors remain separately reported rather than silently folded
  into this change.

### Non-goals for this slice

- Letting the model silently persist arbitrary policy without an explicit user
  confirmation path.
- Replacing Runtime security or capability contracts with prompt text.
- A full policy editor UI or workflow policy migration screen.

### Baseline (2026-08-25)

- `AGENTS.md` is loaded by `skill-load.ts` and embedded by the Core build.
- No `soul.md` loader or embedded soul context exists.
- Workspace chat persistence stores messages and optional workflow mapping only;
  session memo and workflow policy are not persisted or injected into
  command-chat.

### Adoption checkpoint (2026-08-25T01:08:58.0435581+09:00)

- `soul.md` now follows the constitution's load/embed path and is injected as
  voice-only context.
- Session memo and workflow policy are bounded, persisted separately from
  executable workflow IR, and exposed through the guarded `context.update`
  command.
- The host must render an explicit `confirm_context` action before context
  mutation is accepted; Runtime contracts, approval, and side-effect gates
  remain authoritative.
- Verification: Core 93 files/392 tests, eval 11/11, desktop typecheck,
  production build, Electron E2E 12/12, and `git diff --check` passed.

## Current task: separate session source ingest from interactive chat

The workspace must register an uploaded source immediately, run the existing
document engine independently, and expose durable `processing`, `ready`, or
`failed` state to both the source panel and command chat. Chat must not silently
pretend that a processing PDF is absent or fall back to unrelated connected
sources. Review other boundaries touched by this flow and remove only concrete
coupling that causes an unrelated operation to run or blocks an independent
operation.

### Success criteria

- Upload returns a persisted `processing` source before Docling begins or
  finishes, and the UI can continue normal chat while ingest runs.
- Docling completion or failure updates the same source record and manifest;
  no unhandled background rejection or duplicate ingest is possible.
- `session.source.list` exposes status, and `session.source.read` remains
  fail-closed for processing/failed sources with a stable machine-readable
  issue.
- A chat request that needs an uploaded PDF cannot silently use an empty or
  incomplete source snapshot; it receives a bounded pending/error result until
  the source is ready.
- Existing source isolation, bounded reads, failed-ingest behavior, command
  boundaries, Core tests, desktop typecheck, production build, and E2E remain
  green.

### Non-goals for this slice

- Replacing Docling or changing document-engine OCR/table behavior.
- Adding a second persistence format or exposing absolute paths to the agent.
- Refactoring every command into separate packages without a demonstrated
  coupling problem.
- Sending real Gmail/Slack messages or changing external connector scopes.

### Baseline (2026-08-25T01:25:55.4703401+09:00)

- Current source service awaits the complete Docling ingest inside
  `attachToSession`; the desktop source IPC and composer therefore stay busy
  until parsing finishes.
- The command host passes a source snapshot, but there is no independent
  source-ingest lifecycle or host-visible source-update event.
- Focused source/command tests are the pre-change comparison; full regression
  results are recorded in `.harness/experiments.tsv`.

### Adoption checkpoint (2026-08-25T01:47:14.7468439+09:00)

- PDF sources are persisted as `processing` before the existing Docling client
  is queued; the same source transitions to `ready` or `failed` and its
  session manifest is updated.
- `session.source.read` returns a bounded `needs_input` result while a
  source is processing, and a startup recovery pass marks missing stored files
  as `workspace_source_artifact_missing`.
- Source updates use a dedicated Electron event instead of the global
  application state broadcast. The composer no longer treats source ingest as
  an active chat request.
- Verification at this checkpoint: Core 93 files/393 tests, Core eval 11/11,
  Core and desktop typechecks, integration 6/6, document-engine 17 tests
  (2 skipped because pypdf is unavailable), E2E 13/13, dependency cruise,
  and diff check passed.

## Current task: explicit HTTP POST write capability

Expose HTTP writes as an explicit command/runtime capability instead of asking
the read-only capability path to execute a method-changing `http.request`.
Keep the existing generic request path usable for legacy runtime workflows, but
make its read contract reject non-GET/HEAD calls. The new POST path must pass
through the existing workflow/one-shot approval gate and must not add DELETE or
other write methods in this slice.

### Success criteria

- `http.post` is cataloged as a write capability with an explicit POST action
  and external side-effect classification.
- `capability.invoke` remains read-only: it cannot use the generic HTTP read
  capability to send POST, and it cannot invoke `http.post` directly.
- `execution.enqueue_once` and saved workflow steps can represent `http.post`
  and Runtime requests approval before the external call.
- The connector sends a JSON/string POST body correctly and rejects a
  conflicting method override for the fixed POST action.
- Existing HTTP GET/read, integration, command, source, and Electron flows
  remain green; DELETE remains unavailable to the agent command plane.
- Catalog, command skill, tests, and manual fixture documentation describe the
  same capability contract.

### Non-goals for this slice

- Enabling HTTP DELETE, PUT, or PATCH through the agent command plane.
- Adding RDB writes or changing Gmail/Slack permissions.
- Changing the external REST fixture beyond the POST verification needed for
  this capability.

### Adoption checkpoint (2026-08-25T08:18:03.9933277+09:00)

- Existing targeted Core tests passed: HTTP connector/request policy,
  workflow approval/side-effect resolution, command service, and north-star
  checks (6 files, 43 tests).
- Existing integration passed: HTTP 2, Webhook 1, SQLite 1, PostgreSQL 1,
  MySQL 1 (6 tests total).
- Core typecheck passed.
- Current gap: the connector accepts POST at the low-level request layer, but
  the catalog exposes only `http.request` as a read capability; there is no
  explicit `http.post` command contract or regression preventing a POST method
  from entering the read gateway.

### Final verification (2026-08-25T08:32:13.8333437+09:00)

- `http.post` has an explicit catalog/action contract with JSON/string body
  serialization and fixed POST semantics.
- Generic `http.request` POST is rejected by both the capability-invoke and
  runtime read gateways; `http.post` is rejected by the read gateway.
- Workflow and one-shot execution represent `http.post` as an external write
  and pause for Runtime approval before connector I/O.
- Verification passed: Core 96 files/402 tests, targeted POST policy 8 files/63
  tests, command/catalog 3 files/31 tests, Core typecheck, local/Docker
  integration (HTTP/Webhook/SQLite/PostgreSQL/MySQL), production build, and
  Electron E2E 13/13. `git diff --check` passed.

## Completed task: quality-audit fixes 1–10 (2026-08-25)

Applied the ten prioritized recommendations from the UI/UX + non-functional
audit: stale assistant action lockout, dismissible error banner, theme-toggle
click fix (overlay input), connector disconnect confirmations plus a Slack
disconnect path, shutdown chat abort with bounded ingest wait, window-first
startup with googleapis externalized from the main bundle (28MB→2.6MB),
messages_json-free session listing via json_valid, terminology unification
(업무) with Korean Discovery labels, dark-mode chat/run surface tokens,
artifact GC on chat deletion, and a restored `test/manual` REST+PostgreSQL
fixture. Verified with Core 96 files/403 tests, desktop typecheck/build, and
deterministic smoke QA 16/16 (previously 15/16).

## Current task: product QA replay harness

Build a deterministic, data-driven QA harness that exercises AX Studio through
the real Electron UI and host boundaries as a user would, then quantifies
product-level regressions instead of only reporting whether static E2E tests
passed. Repeated runs must remain isolated, must not call real external
connectors, and must produce machine-readable evidence for session lifecycle,
source isolation/recovery, workflow presentation, and in-flight/new-session
behavior.

### Success criteria

- A documented scenario bundle describes user actions and product invariants;
  scenarios are not duplicated as opaque test code.
- A repeatable runner supports selecting scenarios, controlling repetition,
  skipping redundant builds, and writing a JSON report with per-case results,
  durations, failures, and aggregate metrics.
- The suite covers the highest-risk user flows: sending while another request is
  in flight, starting a new conversation without cross-session response leak,
  PDF-only/source lifecycle and failure recovery, workflow registration/reload,
  and rich input/presentation interaction.
- Each repetition starts from an isolated data root and uses the deterministic
  E2E provider/document seams; no Gmail, Slack, HTTP, or database side effect is
  allowed in repeated product QA.
- The report quantifies pass/fail rate, p50/p95 duration, timeout/error count,
  session response leakage, source leakage, and recovery failures. A failed
  invariant identifies the scenario and repetition and leaves Playwright
  artifacts for diagnosis.
- Existing Core and Electron E2E regressions remain green.

### Non-goals for this slice

- Claiming production connector reliability from fake-provider runs.
- Load testing the Electron app with parallel workers or hundreds of external
  API calls.
- Replacing the existing focused E2E specs or changing production behavior
  solely to make the QA harness pass.

## Current task: Dev/Stable data split and Gmail OAuth hardening

Separate unpackaged `npm run dev` from the installed AX Studio so dogfooding
on this PC cannot share DB, credentials, or the Electron single-instance lock.
Harden Gmail OAuth for a packaged RC: bake only `GOOGLE_OAUTH_CLIENT_ID` at
build time, drop `client_secret`, and validate OAuth `state` on the loopback
callback.

### Success criteria

- Unpackaged desktop uses `%LOCALAPPDATA%/AXStudio-dev` (and a Dev Electron
  `userData`) unless `AX_DATA_ROOT` is set.
- Packaged desktop keeps `%LOCALAPPDATA%/AXStudio`.
- Dev and Stable can run at the same time (different app name / userData /
  single-instance lock).
- Existing AXStudio data is not migrated into AXStudio-dev.
- Gmail OAuth no longer reads or documents `GOOGLE_OAUTH_CLIENT_SECRET`.
- Loopback callback rejects a missing or mismatched OAuth `state`.
- Production desktop build embeds `GOOGLE_OAUTH_CLIENT_ID` from repo `.env` if
  the process env is empty.
- Core oauth/path tests, desktop typecheck, and desktop production build pass.

### Non-goals for this slice

- HTTP multi-connection.
- Removing `gmail.send` from requested scopes (forces re-consent; defer).
- Google OAuth verification / public Gmail Restricted-scope launch.
- Auto-copying current AXStudio data into the Dev profile.

## Current task: packaged app crash on missing `undici`

The installed AX Studio fails at main-process load with
`Cannot find module 'undici'` from `@slack/socket-mode`. Vite externalizes
that SDK; electron-builder packed `socket-mode` but skipped `undici` because
it is only a peerDependency.

### Success criteria

- Packaged main process can `require('undici')` from `app.asar`.
- Unpacked Windows build starts without the `Cannot find module 'undici'` dialog.
- Desktop production build still passes.

### Non-goals for this slice

- Bundling `googleapis` back into the main chunk.
- Changing Slack Socket Mode runtime behavior.

## Current task: packaged launch schema + single release folder

Installed AX Studio now fails after `undici` with `no such column: workflow_id`.
The dogfood DB still has `executions.skill_id` / `skill_version`. Pack output
must stay in `apps/desktop/release` only.

### Success criteria

- Opening a legacy DB with `executions.skill_id` migrates to `workflow_id` without throwing.
- `createDatabaseAsync` can create a new execution on that database.
- Windows installer is written to `apps/desktop/release`, not a second output folder.

## Current task: persist desktop logs to the data-root logs folder

Dev and packaged AX Studio create `<dataRoot>/logs` but never write `.log` files.
Dogfood failures (agent timeout, command-chat max rounds) only appear in the UI.

### Success criteria

- Enabling file logging writes `logs/ax-studio-YYYY-MM-DD.log` under the AX data root.
- File logging is off by default so core tests do not write into the real AXStudio folder.
- Desktop main process enables file logging at startup and tees console plus command-chat failures.
- Path and app-log unit tests pass; desktop typecheck passes.

## Current task: job registration as a host transaction

Replace the 8-round agent mutation loop for recurring scheduled work with a
host-owned job registration flow. The user describes the job once; the agent
emits one `job.propose` spec; the host compiles Workflow IR, shows a
confirmation card, and commits on the confirm button without another LLM loop.

### Success criteria

- `job.propose` without a Slack channel returns `needs_input` and does not save a workflow.
- `job.propose` with a full spec returns a confirmation card (`purpose: confirm_job`) and does not save yet.
- `job.commit` without a prior propose, or without `allowJobCommit`, is forbidden and saves nothing.
- After host-confirmed `job.commit`, a scheduled workflow is saved, optionally run once, mapped to the chat session, and `allowExternalAuto` is applied only after that confirmation.
- Command chat intercepts the confirm action and skips extra model commands.
- Recurring HTTP+AI+Slack work uses `job.propose` once; max rounds is not raised.
- HTTP origin lock remains fail-closed: disconnected HTTP or an off-origin path does not save a workflow.
- Targeted command tests, core typecheck, and desktop typecheck pass.
- `job.propose` accepts compact string `interpret`/`notify`/`fetch`/`schedule` values and never shows raw Zod JSON in chat.

## Current task: multiple HTTP connections bound per job

Settings can store more than one HTTP API. A job/workflow HTTP step saves
`connectionId` once at registration. Later runs use that saved connection.
Existing jobs without `connectionId` keep using the first/`default` HTTP.

### Success criteria

- Legacy `{ baseUrl }` config becomes the `default` HTTP endpoint.
- A second HTTP can be added without replacing GitHub.
- Disconnecting one HTTP leaves the others.
- `http.request` GET uses `params.connectionId` when present, otherwise `default` or the only connection.
- `job.propose` with one HTTP still auto-binds. With two, it asks for the connection name unless `fetch.connectionId` is set, then persists that id on the fetch step.
- Relative paths cannot leave the saved connection's base URL.
- Targeted HTTP/job tests, core typecheck, and desktop typecheck pass.

### Non-goals for this slice

- A canvas picker UI to change HTTP after save (chat/workflow.update can still name another connection).
- Arbitrary URLs that are not one of the saved HTTP connections.
- Packaging a new Stable installer.

## Current task: whole-product finishing pass (마감)

Audit the entire product — core engine/runtime/workflow/store/modules, agent
command plane, and the desktop UI/electron main — and fix concrete finishing
defects: stale single-HTTP assumptions, dead code left by refactors, UI copy
and state inconsistencies, IPC/type drift, and error paths that mislead the
user. Only fix verified defects; no feature work, no speculative refactors.

### Success criteria

- Every remaining consumer of the HTTP connection model handles multiple
  endpoints (module registry instantiate, read gateways, summaries, UI).
- Audit findings classified BUG/RISK are fixed or explicitly deferred with a
  reason; COSMETIC fixes only where trivial and safe.
- Full evaluator green: core tests, core eval, core+desktop typecheck,
  desktop production build, Electron E2E, product QA replay.
- Final diff stays within the audited defects; no discarded experiment code.

### Non-goals for this slice

- New features or connector expansion.
- Rewriting subsystems that merely look old but behave correctly.
- Packaging a new Stable installer.

## Current task: required CI verification for `main`

Add a repository-owned GitHub Actions verification workflow so pull requests and
pushes to `main` run the same deterministic checks before merge. Keep the CI
boundary honest: do not call missing `test/e2e` or `test/integration` entrypoints,
and do not invoke live Gmail, Slack, AI, or database side effects from CI.

### Success criteria

- `.github/workflows/ci.yml` runs on pull requests and pushes to `main`.
- The required `verify` job installs with `npm ci`, runs core tests/evaluation,
  builds the application, checks architecture, and runs the
  deterministic Electron product smoke suite under an isolated data root.
- Pull requests receive a review checklist without exposing secrets or enabling
  external connector side effects.
- The known missing `test/e2e` and `test/integration` runners are recorded as
  gaps rather than silently represented as passing CI checks.
- The workflow itself passes YAML/static inspection and every local check that
  can be run on this Windows host passes or has an evidence-backed baseline.

### Non-goals

- Repairing or inventing the missing `test/e2e` and `test/integration` runners.
- Running live provider, connector, HTTP, or database tests in GitHub Actions.
- Rewriting the existing dirty worktree or unrelated product code.

## Current task: Work Discovery session contract hardening

Make the agreed Work Discovery session contract true at the public service and
command boundaries before attempting the larger lifecycle deepening. Preserve
the requested recurrence in durable session state, reject stale answer/publish
mutations, and make repeated publication of one session idempotent.

### Success criteria

- `desiredRecurrence` supplied to `start()` is present after session reload and is used by blueprint compilation.
- `answer()` and `publish()` reject a stale `expectedRevision` without changing session state or creating a workflow.
- Matching-revision answer and publish paths retain existing behavior.
- Repeating publish for an already published session returns the original workflow id and does not create another workflow version/row.
- Targeted Work Discovery tests, full Core tests, Core typecheck, and diff-whitespace checks pass.

### Non-goals for this slice

- Automatic restart recovery and retry leases for an interrupted pipeline.
- Persisting every replay case as a first-class queryable record.
- Source binary copying or a new artifact storage backend.

## Current task: first-class Work Discovery replay cases

Persist each discovery session's per-example replay evidence through the
existing `work_discovery_replay_cases` storage boundary. Re-running a session
must update the same replay case for that session/example instead of creating
duplicates, so later restart recovery and inspection can rely on durable
evidence rather than only the session JSON blob.

### Success criteria

- Every completed replay example has one persisted replay case with its expected observations and latest candidate results.
- Re-running the same session/example updates the existing replay case without duplicate rows.
- Replay cases remain isolated by discovery session and example.
- Existing Work Discovery behavior, targeted tests, Core tests, Core typecheck, and diff-whitespace checks remain green.

### Non-goals for this slice

- Automatically resuming an interrupted pipeline after app restart.
- Replacing live source reads with snapshot replay during recovery.
- New UI for browsing replay-case history.

## Current task: Work Discovery restart recovery

Resume an interrupted Work Discovery pipeline from durable checkpoints when a
new service instance starts. A completed source inventory checkpoint must use
the persisted source snapshot manifests instead of silently reading changed
live sources; incomplete earlier stages may fall back to a clean pipeline
restart without claiming that the old checkpoint was reused.

### Success criteria

- A new `WorkDiscoveryService` configured for startup recovery schedules persisted in-progress sessions.
- Sessions at `synthesizing` or `validating` resume from persisted observations, source inventory, and snapshot manifests without calling live source providers.
- The resumed session writes/upserts replay cases and reaches the same clarification/ready outcome as a clean run.
- Published and cancelled sessions are never auto-resumed.
- Existing session-contract, replay-persistence, Work Discovery, Core typecheck, and diff-whitespace checks remain green.

### Non-goals for this slice

- Infinite or automatic retry loops; one recovery attempt and `needs-attention` state come later.
- Recovery of missing/corrupt snapshot manifests beyond a safe clean restart/failure path.
- Desktop recovery UI or external connector changes.
- Broad refactoring of `WorkDiscoveryService`, Desktop UI, or unrelated dirty WIP.

## Current task: bounded Work Discovery recovery retry

Make automatic recovery bounded and user-visible. A persisted in-progress
session may receive one automatic recovery attempt. If that attempt fails, the
session must enter `needs_attention` instead of becoming an unrecoverable
terminal failure or being retried in a loop. A user may explicitly retry with
the current session revision; the retry must reuse a safe persisted synthesis
checkpoint when available and must not publish or reread a missing snapshot
silently.

### Success criteria

- The session schema and inspect view can represent `needs_attention` and its recovery checkpoint.
- A second startup does not automatically rerun a session whose automatic recovery attempt is already recorded.
- Automatic recovery failure becomes `needs_attention` with a durable error and checkpoint.
- `discovery.retry` requires the current `expectedRevision`, resumes the safe checkpoint, and returns a conflict without mutation for stale callers.
- Published and cancelled sessions remain terminal and cannot be retried.
- Focused recovery/command tests, Core tests, Core typecheck, and diff-whitespace checks pass.

### Non-goals for this slice

- Restarting from an arbitrary historical checkpoint selected by the user.
- A desktop-specific recovery card or new external connector behavior.
- Automatic retries beyond the single startup attempt.
- Deleting session evidence or changing workflow publication semantics.

## Current task: Agent prompt and job contract public seam

Finish the existing Agent WIP unit by making its prompt composition, skill
directory override, and job proposal output type reachable through stable
Agent entrypoints. Preserve the existing prompt and job-registration runtime
behavior while making the intended contracts testable.

### Success criteria

- A caller of the Core Agent entrypoint can configure an external skill root
  and the command prompt uses its `command/SKILL.md` content.
- The prompt barrel is used by the existing harness and command-chat paths and
  is reachable from the Agent entrypoint.
- `AxJobProposeArgs` is re-exported through the command and Agent entrypoints.
- Focused Agent tests, the full Core suite, Core typecheck/build,
  dependency-cruiser, and diff-whitespace checks pass.

### Non-goals for this slice

- Changing the job schema, scheduling semantics, or workflow persistence.
- Reworking prompt wording, model providers, or connector behavior.
- Completing unrelated Product QA, path-security, or RDB WIP changes.

## Current task: main-based Work Discovery production path

Starting from the merged `main` baseline, make the user-facing Work Discovery
path safe and verifiable in small phases. The first phase owns the boundary
between a Workspace chat session and its Discovery session.

### Phase 1 success criteria

- Starting, loading, switching, deleting, or creating a Workspace chat cannot
  leave an unrelated Discovery review card attached to the visible chat.
- Discovery answer and publish mutations include the last inspected revision
  and surface revision conflicts instead of silently ignoring them.
- Desktop exposes bounded cancel and retry actions for Discovery states that
  support them; no retry loop is introduced.
- Existing Core behavior, Desktop typecheck/build, deterministic Product QA
  smoke, and whitespace checks remain green.

### Phase 1 non-goals

- Changing the Work Discovery algorithm, WorkflowIR, Runtime, or connector
  side effects.
- Fixing connected-folder spreadsheet inventory; that is the next bounded
  phase.
- Adding root integration/E2E runners, drift detection, or repair behavior in
  this phase.

## Current task: main-based Work Discovery production path — Phase 2

Starting after the completed Desktop session-boundary phase, make connected
local folders usable as Work Discovery spreadsheet sources.

### Phase 2 success criteria

- A connected local-folder configuration with one or more folders yields
  discoverable CSV, XLS, and XLSX file descriptors, including nested files.
- Each descriptor can be profiled through a stable source ID and returns a
  table without reading outside its configured folder.
- Missing folders, malformed local-folder configuration, unsupported files, and
  corrupt spreadsheets are skipped or rejected without crashing the whole
  discovery inventory.
- Existing local-folder path-security tests, Work Discovery/Core regression,
  Desktop typecheck/build, deterministic Product QA smoke, and whitespace
  checks remain green.

### Phase 2 non-goals

- Changing the Work Discovery algorithm, WorkflowIR, Runtime, or connector
  side effects.
- Adding provider-wide failure isolation or drift/repair behavior; those remain
  later bounded phases.

## Current task: main-based Work Discovery production path — Phase 3

Prove the Desktop Work Discovery path through the real Electron boundary with
deterministic fixtures and a narrowly gated test seam.

### Phase 3 success criteria

- A deterministic Electron scenario configures a fixture folder, imports a
  spreadsheet example, starts Discovery, and reaches `ready_to_publish`.
- The scenario verifies that changing to a new Workspace chat removes the old
  Discovery card and that publishing persists a workflow through the Desktop
  IPC boundary.
- Discovery-only E2E seams are exposed only for an unpackaged `AX_E2E=1` run,
  accept only regular files/directories inside `test/fixtures`, and are absent
  from packaged production.
- The existing Product QA smoke/session/document scenarios and Core Discovery
  regressions remain green.

### Phase 3 non-goals

- Live-provider or external-connector side effects.
- Recovery retry fault injection; this phase proves the happy path and chat
  isolation boundary.
- Root integration/E2E runner repair, persistence schema hardening, or result
  drift/repair behavior.

## Current task: main-based Work Discovery production path — Phase 4

Restore the repository-level test entry points so a fresh checkout has one
truthful command for the Electron product path and one for Core integration
coverage. The runners must forward failures, avoid external providers, and
keep their selected suites bounded and reproducible.

### Phase 4 success criteria

- `npm run test:e2e` builds the desktop app when needed and runs the
  deterministic Electron Product QA suite through the real main/preload/
  renderer boundary.
- `npm run test:integration` runs the Core integration boundary suite and
  returns the underlying test exit status instead of silently passing.
- Both root runners work from a clean checkout, accept documented extra
  arguments where appropriate, and do not require live provider credentials or
  external network side effects.
- Existing Core, Desktop, Product QA, architecture, and whitespace checks
  remain green.

### Phase 4 non-goals

- Adding new connector behavior or replacing the existing unit-test suite.
- Starting Docker services or requiring unavailable external infrastructure for
  the default integration command.
- Persistence schema changes or result drift/repair behavior; those remain the
  next bounded phases.

### Phase 4 final checkpoint (2026-08-30)

- `npm run test:e2e` now builds the desktop app and passes the deterministic
  Electron Product QA suite.
- `npm run test:integration` now runs the bounded Core integration boundary
  suite without external credentials or side effects.
- The repository test harness typechecks cleanly with
  `npx tsc -p test/tsconfig.json --noEmit`.

## Current task: main-based Work Discovery production path — Phase 5

Make persisted artifact sidecars trustworthy at the ArtifactStore boundary.
The existing JSON file layout remains compatible, but typed document, ingest,
workbook, and table payloads must be validated when written and read. Artifact
IDs must remain filenames inside the configured artifact root.

### Phase 5 success criteria

- Document and document-engine ingest sidecars are validated against explicit
  schemas on write and read; malformed sidecars are treated as unavailable.
- Workbook and table sidecars have typed read/write helpers, and Work
  Discovery uses them without regressing existing generic JSON artifacts.
- Artifact IDs reject path separators, traversal, empty values, and other
  filename-escaping input before any filesystem access.
- Existing PDF, spreadsheet, workspace-source, Work Discovery, root
  integration, Desktop, and Product QA checks remain green.

### Phase 5 non-goals

- Changing the on-disk directory layout or migrating existing valid sidecars.
- Retrofitting every unrelated SQLite JSON column in one patch.
- Changing document-engine output semantics, connector behavior, or workflow
  execution.

### Phase 5 final checkpoint (2026-08-31)

- ArtifactStore typed sidecars now validate on write and fail closed on read.
- Workbook and table sidecars use explicit typed helpers while generic JSON
  remains available for intentionally untyped payloads.
- Filename-escaping IDs and metadata paths outside the artifact root are
  rejected without touching the outside path.
- Full Core tests, Core eval, Core/Desktop build, root integration, and root
  Electron E2E remain green.

## Current task: main-based Work Discovery production path — Phase 6

Recover the module boundaries exposed by the architecture check. The existing
dependency rules are intentional and must remain strict: Work Discovery must
not import connector implementations, and connector modules must not import
each other. Shared local-folder configuration, path-safety, scanning, and
worker primitives need a platform-level home that can be used by local-sheet
discovery without creating a module-to-module dependency.

### Phase 6 success criteria

- `npm run arch:check` reports zero dependency violations without weakening or
  deleting an existing rule.
- Work Discovery observation tests use contract-level fixtures and do not
  import the local-sheet implementation.
- Local-sheet discovery uses shared platform local-folder primitives while
  existing local-folder callers and the Electron scan worker remain compatible.
- Core typecheck, the affected Core regressions, root integration, full Core
  tests, Core evaluation, Desktop build, and root Electron E2E remain green.

### Phase 6 non-goals

- Changing connector behavior, Work Discovery semantics, or workflow execution.
- Rewriting the local-folder scanner or introducing live-provider behavior.
- Broad module renaming, unrelated cleanup, or weakening architecture rules.

### Phase 6 final checkpoint (2026-08-31)

- The strict architecture check reports zero violations after moving shared
  local-folder configuration, path, scan, async, and worker primitives behind
  the platform boundary.
- Work Discovery observation tests use contract-level workbook fixtures, and
  the Electron worker still bundles and runs through the existing output path.
- Full Core tests, Core evaluation, Core/Desktop build, root integration, and
  root Electron E2E remain green.

## Current task: main-based Work Discovery production path — Phase 9

Add a persisted output contract and runtime quality gate for published Work
Discovery workflows. Historical observations define presence/type baselines;
multiple examples may additionally define conservative numeric and row-volume
ranges. Input schema drift and output degradation must be recorded as distinct
technical/result failures, and external actions must not run after a failed
quality check. Expose a minimal `execution.explain` read command without
returning raw execution parameters or result payloads.

### Phase 9 success criteria

- Discovery blueprints and compiled workflows persist bounded output and input
  contracts without storing raw historical values.
- Runtime detects missing source columns, incompatible source types, missing
  output sections, output type changes, and multi-sample numeric/row-volume
  anomalies with stable issue codes.
- A failed contract prevents later external side effects and separates
  technical execution status from result quality in the execution record/log.
- `execution.explain` returns an inspectable, sanitized reason for a blocked or
  degraded execution.
- Desktop activity distinguishes technical completion from result-quality
  failure for these executions.
- Core typecheck, focused contract/runtime/command tests, full Core tests,
  evaluation, build, integration, Electron E2E, and architecture checks pass.

### Phase 9 non-goals

- No automatic repair, remapping, threshold/recipient/approval/schedule
  changes, or provider-side writes; those belong to Phase 10.
- No raw output rows, message bodies, or historical values in contracts,
  failure logs, or `execution.explain`.
- No change to the existing ArtifactStore layout or connector semantics beyond
  the runtime quality gate.

### Phase 9 final checkpoint (2026-08-31)

- Work Discovery now compiles bounded output/input contracts into persisted
  workflow versions; single-sample numeric baselines remain presence/type-only.
- Runtime blocks external actions when input schema or output quality drifts and
  stores only sanitized issue metadata.
- `execution.explain` and Desktop activity expose the distinction between
  technical completion and result-quality failure.
- Core, evaluation, build, Desktop typecheck, integration, Electron E2E,
  architecture, and whitespace checks passed.

## Current task: connector foundation safety and acceptance — Phase 1

Begin the ordered completion plan for the six in-scope product surfaces:
PDF, Webhook, HTTP/REST, RDB, Gmail, and Slack. This first bounded slice fixes
the already-evidenced secret and trigger-reliability risks and establishes
public behavior seams for the later connector/product work. It does not add
rich Gmail/Slack messaging, PDF template editing, or broad settings redesign.

### Phase 1 success criteria

- Remote RDB credentials remain in the main-process/OS secret boundary and are
  never returned in renderer connection state or loaded into the renderer form.
- A trigger receipt whose `processing` lease is stale can be reclaimed exactly
  once, while fresh `processing` and `completed` receipts remain deduplicated.
- Webhook events preserve an authenticated provider idempotency/event key when
  supplied, so a retry produces the same event request id; requests without a
  key retain unique request ids.
- Focused regression tests exercise the three public seams before and after
  the implementation.
- Existing Core and Desktop type/build checks remain green; no external
  Gmail/Slack credentials or side effects are used.

### Phase 1 non-goals

- No PDF template editor, PDF artifact download/preview, or Gmail/Slack
  attachment implementation.
- No HTTP/DB query-builder or connector action-lab UI.
- No provider-side live tests, schema migration, or broad trigger redesign.
- No changes to the existing unrelated dirty `.gitignore` modification.

### Phase 1 final checkpoint (2026-08-31T12:01:20.2861771+09:00)

- Remote RDB connection strings are no longer returned in renderer-facing
  connection summaries or restored into the RDB settings form.
- Trigger receipts reclaim only stale `processing` rows using a bounded lease;
  fresh and completed rows remain deduplicated.
- Webhook listener preserves supported provider idempotency/event headers and
  still generates unique IDs for keyless requests.
- Focused tests, full Core regression, Core/Desktop/test typechecks, evaluation,
  architecture check, production build, root integration runner, Electron E2E,
  and whitespace checks passed.

## Current task: main-based Work Discovery production path — Phase 10

Add conservative repair support for persisted Work Discovery workflows. When
the Phase 9 input-schema gate detects a missing or changed source column, the
runtime may persist a bounded rename/remap proposal, but it must never change
workflow meaning automatically. A repair can be inspected, rejected, or
applied only after every persisted historical replay case passes. Applying a
repair creates a new workflow version and leaves the prior version available
for rollback.

### Phase 10 success criteria

- Input-schema drift can produce a deduplicated, bounded repair proposal with
  rename/remap candidates and no raw rows, values, credentials, or payloads.
- `repair.list`, `repair.inspect`, `repair.apply`, and `repair.reject` are
  exposed through the command boundary with stale-version and lifecycle
  checks.
- A candidate is applicable only when every available historical replay case
  passes; missing or unreadable replay evidence blocks apply.
- Apply changes only the selected source-column mapping and its matching input
  schema, creates a new workflow version, and does not alter thresholds,
  recipients, approvals, triggers, schedules, side effects, or external action
  parameters.
- Reject is durable and apply is reversible by retaining the pre-repair
  workflow version; no automatic repair occurs during runtime execution.
- Core typecheck, focused repair/replay/command/runtime tests, full Core,
  evaluation, build, Desktop typecheck, integration, Electron E2E,
  architecture, and whitespace checks pass.

### Phase 10 non-goals

- No automatic workflow remapping or semantic inference beyond proposing a
  user-reviewable column rename/remap candidate.
- No threshold, recipient, approval, AND/OR, schedule, trigger, side-effect,
  connector, or external action parameter changes.
- No live-source replay, provider calls, or external connector side effects
  during inspect or apply.
- No new workflow editor or broad UI redesign; command and existing versioned
  storage surfaces are sufficient for this phase.

### Phase 10 final checkpoint (2026-08-31T01:26:49.0009816+09:00)

- Conservative repair is complete: input-schema drift can create a bounded,
  deduplicated rename/remap proposal; inspect and apply replay only persisted
  historical snapshots, and unavailable evidence blocks apply.
- `repair.list`, `repair.inspect`, `repair.apply`, and `repair.reject` enforce
  read/mutation boundaries, stale-version checks, lifecycle checks, and
  user-selected candidate application.
- Applying a candidate changes only the source-column mapping and matching
  input schema, creates the next workflow version, and retains the previous
  version for rollback. Runtime execution never auto-applies a repair.
- Focused repair/runtime/command checks passed 5 files/54 tests; full Core
  passed 122 files/620 tests with 3 skips; evaluation passed 11/11;
  architecture, typechecks, production build, integration, Electron E2E,
  and whitespace checks passed.

## Current task: main-based connector completion — PDF Phase 2

Make the existing PDF write path durable on the main-aligned baseline. A
successful desktop PDF print must be persisted under the configured generated
reports directory, and the workflow runtime must retain only a safe artifact
reference and sanitized execution metadata. The raw PDF bytes must not travel
through workflow variables, step results, checkpoints, or execution logs.

### Phase 2 success criteria

- `ArtifactStore` can persist generated bytes with a content hash, safe file
  name, metadata sidecar, and deduplicated lookup under its configured root.
- The runtime injects a generated-report artifact sink into both fresh and
  approval-resumed executions.
- `document.pdf.generate` persists completed PDF output under
  `generated/reports`, returns an artifact reference without a local path or
  raw bytes, and logs only sanitized artifact metadata.
- Missing persistence infrastructure fails closed with a stable connector
  error instead of reporting a durable PDF success.
- Focused PDF/store/runtime tests, full Core regression, typechecks, build,
  architecture, and whitespace checks pass without changing external provider
  behavior or the unrelated `.gitignore` edit.

### Phase 2 non-goals

- No PDF template editor, browser preview, user-selected export/download IPC,
  or renderer redesign in this slice.
- No Gmail/Slack attachment delivery, live provider calls, or credential
  changes.
- No change to the Python PDF-to-HTML conversion engine or broad artifact
  schema migration.

### Phase 2 final checkpoint (2026-08-31T12:50:37.8037370+09:00)

- Generated PDF bytes are persisted below `paths.generated.reports` with a
  content hash, safe file name, metadata sidecar, and content deduplication.
- Fresh and approval-resumed runtime contexts receive the same host-owned
  artifact sink; the PDF connector exposes only a path-free artifact reference
  and sanitized `pdf_generated` metadata.
- Missing storage and missing desktop print infrastructure fail closed, and
  storage failures have a distinct error code.
- Focused PDF/store/runtime checks passed 3 files/41 tests; full Core passed
  124 files/641 tests with 3 skips; Desktop typecheck, document-engine tests,
  integration, Product QA/E2E, knip, evaluation, architecture, production
  build, and whitespace checks passed.

## Current task: main-based connector completion — PDF Phase 3

Make persisted generated PDF artifacts findable and exportable from the
Desktop Activity surface. The renderer may receive only sanitized artifact
metadata and an opaque artifact ID; the main process must resolve the ID below
the configured generated-reports directory, validate the stored file, and let
the user choose the export destination through the native save dialog.

### Phase 3 success criteria

- `pdf_generated` execution log entries are summarized into safe PDF metadata
  without exposing `storedPath`, raw bytes, or arbitrary filesystem paths.
- A trusted main-process IPC handler can export only a valid generated PDF by
  opaque artifact ID, rejects invalid/missing/non-PDF/out-of-root files, and
  reports cancellation or copy failures without leaking paths.
- The preload and renderer types expose the export operation explicitly, and
  Activity shows a keyboard-accessible PDF result row only when an artifact is
  present, with pending/success/error feedback.
- Focused export/state-summary tests, Core regression, Desktop/test
  typechecks, production build, integration/Electron QA, architecture, and
  whitespace checks pass without changing provider behavior or the unrelated
  `.gitignore` edit.

### Phase 3 non-goals

- No PDF template editor, browser preview, report library redesign, or
  automatic cleanup/retention policy.
- No Gmail/Slack attachment delivery, live provider calls, or credential
  changes.
- No raw artifact content, local absolute paths, or renderer-controlled output
  destinations cross the IPC boundary.

### Phase 3 final checkpoint (2026-08-31T14:26:14.4605446+09:00)

- Generated PDF metadata is projected into Activity without stored paths or raw
  PDF bytes.
- Main-process export resolves opaque artifact IDs below the generated-reports
  root, validates PDF MIME, regular-file status, canonical containment, and
  exact size, then copies only to a native save-dialog destination.
- Activity exposes a keyboard-accessible export action with pending, success,
  cancellation, and path-free error states.
- Focused export/state-summary tests passed 2 files/7 tests; Core passed 125
  files/649 tests with 3 skips; typechecks, architecture, production build,
  integration, Product QA/E2E, and whitespace checks passed.
- Completed Codex Security diff scan found 0 findings across all 13 reviewed
  change-inventory items. Native dialog UI automation remains a documented
  limitation; its provider seam is covered by unit tests.

## Current task: main-based connector completion — Webhook vertical slice

Make the Webhook path directly usable before moving to REST/DB, Gmail, and
Slack. The saved connection must correspond to a running local listener, a
real authenticated POST must reach the matching active workflow exactly once
per provider event id, and the Desktop state must expose listener failures
instead of showing a false connected state. Add a local manual fixture so the
developer can verify the path with curl without external provider accounts.

### Webhook success criteria

- Connecting a valid port and secret starts a local listener and persists only
  non-secret connection metadata; disconnect stops it and removes the secret.
- A signed or shared-secret POST returns an explicit accepted response and
  reaches the matching active workflow with bounded path/body/header input.
- Repeating the same provider event id does not execute the workflow twice;
  keyless deliveries remain distinct.
- Invalid method/path/auth/oversized payloads are rejected without execution.
- A port collision or listener startup failure is visible as a disconnected or
  errored transport state and never remains a false healthy connection.
- Restart/hydration starts the configured listener when its secret is present;
  stop/reconnect leaves no live listener behind.
- A local manual Webhook fixture and step-by-step curl smoke scenario are
  documented, with cleanup and no external network/provider side effects.
- Focused Webhook tests, Core regression, typechecks, architecture check,
  integration/E2E checks, production build, and whitespace check pass.

### Webhook non-goals

- No public tunnel provisioning, outbound Webhook action, or provider-specific
  webhook management API.
- No Gmail/Slack implementation in this slice and no live credentials.
- No broad trigger-engine rewrite or database schema migration.
- No changes to the unrelated dirty `.gitignore` file.

### Webhook vertical slice final checkpoint (2026-08-31T16:43:38.2827736+09:00)

- The Webhook setting now reflects the actual loopback listener state; port
  collisions and refresh failures cannot remain falsely connected.
- Authenticated shared-secret/HMAC POSTs reach active workflows, stable
  provider event IDs are deduplicated per workflow, and auth headers are
  excluded from workflow input.
- A stale Slack OS-encrypted token no longer aborts desktop startup; it becomes
  a disconnected, user-visible reconnect state.
- Focused Webhook tests passed 32/32; Desktop state/recovery tests 5/5; Core
  integration 72/72; full Core 651 passed with 3 skips; live Product QA 2/2;
  deterministic Product QA/E2E 4/4; types, architecture, build, evaluation,
  knip, and whitespace checks passed.
- Final Codex Security diff scan reviewed 19 formal change items and reported
  0 findings. Manual loopback smoke delivery was separately executed for both
  shared-secret and HMAC modes.

## Current task: security-report hardening — manual Webhook redirects

Close the only reproducible hardening candidate from the PR #122 security
report. The local manual Webhook sender must never automatically follow a
redirect after its initial loopback URL validation, because a redirect can
otherwise forward the request body, event ID, shared secret, or HMAC signature
to a different origin.

### Security hardening success criteria

- Every HTTP redirect is handled as a failed delivery without contacting its
  destination, for both shared-secret and HMAC modes.
- A direct loopback `202` request still sends the original body, event ID, and
  selected authentication header successfully.
- `--check` remains network-free and successful.
- The black-box regression test is part of the root `npm test` CI path.
- Focused Webhook regressions, the root test suite, production build,
  architecture check, and whitespace check pass on the latest `main` baseline.

### Security hardening non-goals

- No production Webhook listener, authentication protocol, receipt storage,
  provider-header projection, tunnel, proxy, or rate-limit redesign.
- No compatibility-breaking timestamp/nonce requirement without a provider
  protocol and migration decision.
- No live provider, tunnel, Gmail, or Slack calls.
- No change to the user-owned `.gitignore` modification in the primary
  worktree.

### Security hardening final checkpoint (2026-08-31T17:53:32.9665788+09:00)

- The manual sender now handles redirects without following them, so 302/307
  destinations receive no request in shared-secret or HMAC mode.
- Direct loopback 202 delivery and network-free `--check` behavior remain
  intact.
- The black-box test runs on Node 22 and Node 24 and is part of root
  `npm test`.
- Independent review found no surviving redirect bypass. Its one confirmed
  test-argument forwarding regression was fixed by keeping the existing Core
  test command last in the root script.

## Current task: local connector lab for REST and Webhook manual QA

Add a single long-running, loopback-only test fixture under
`test/connector-lab` so a developer can use AX Studio directly against a
realistic local REST API and exercise AX Studio's Webhook receiver through a
local provider simulator. The lab must preserve the existing manual fixtures,
record safe request/response observations for review, and remain deterministic
and easy to stop.

### Success criteria

- `npm run test:connector-lab` starts a local REST API and a Webhook provider
  control server and prints the actual URLs and manual setup steps.
- REST supports connection probing, representative GET/POST flows, auth
  variants, controlled errors, slow/large responses, and safe request logging.
- Webhook scenarios cover accepted delivery, duplicate event IDs, HMAC,
  invalid authentication, unknown paths, wrong methods, and oversized payloads
  without sending outside loopback.
- Each lab run writes an append-only JSONL event log and a shutdown summary
  without secrets, credentials, raw request bodies, or absolute paths.
- Automated tests exercise the public local HTTP seams and pass without Docker,
  external provider accounts, or a running AX Studio instance.
- Existing manual fixtures, production connector behavior, and the user's
  unrelated `.gitignore` change remain untouched.

### Non-goals

- No production REST/Webhook connector changes or protocol redesign.
- No public tunnel, internet delivery, Gmail/Slack calls, database container,
  or persistence migration.
- No attempt to make the test-side provider simulator the product's Webhook
  receiver; AX Studio remains the receiver under test.

### Objective-contract correction (2026-08-31T18:39:28.3216372+09:00)

The fixture must model an independent partner/internal service rather than
echoing AX-specific names and payloads. REST responses and sample credentials
therefore use the Acme Operations API contract, and Webhook bodies use a
provider-style `id`/`type`/`createdAt`/`data` envelope. Only the final Webhook
delivery headers remain AX-compatible because those headers are the protocol
being tested; the fixture does not import production AX modules.

### Connector lab final checkpoint (2026-08-31T18:44:16.3040689+09:00)

- Added `test/connector-lab` with one-command long-running startup for an
  independent Acme Operations REST API and Acme Billing Events provider
  simulator.
- REST covers probe, seeded reads, POST side effect, three auth styles,
  deterministic 4xx/5xx, slow/large responses, and redirect behavior.
- Webhook covers accepted, duplicate, HMAC, invalid secret, unknown path,
  wrong method, oversized payload, and arbitrary event delivery through a
  loopback-only target.
- Run logs store only request/response metadata and hashes; secrets, raw bodies,
  response text, and absolute log paths are excluded. Shutdown summaries are
  written per run.
- Connector lab tests passed 2/2, existing Webhook security tests passed 3/3,
  root Core tests passed 651 with 3 skips, architecture passed with zero
  violations, and the production build passed.

## Current task: dogfood Gmail OAuth and Slack Socket Mode diagnostics

Use the user's real-runtime log to close the configuration and observability
gaps found during manual connector QA. Gmail must propagate the configured
OAuth client secret to the token exchange when one is required. Slack Socket
Mode must preserve useful nested WebSocket failure details and keep its
transport lifecycle truthful when the SDK reconnects after an error.

This task supersedes the earlier public-Desktop-client assumption that
`client_secret` should never be read. The observed Google token response proves
that at least one configured client requires it; support is therefore optional
and development-only, without embedding it in packaged builds.

### Success criteria

- `GOOGLE_OAUTH_CLIENT_SECRET` is loaded only as a main-process credential,
  passed to the Core loopback OAuth client, and never persisted in workflow
  metadata or exposed in UI/log output.
- Gmail has a deterministic regression test for the exact missing-secret
  propagation bug and documents the matching local configuration.
- Slack errors retain nested `cause`, `original`, and transport error details
  without logging tokens or raw WebSocket URLs.
- Slack Socket Mode state and stop behavior remain truthful during SDK
  reconnect/error transitions; repeated SDK errors do not create an unbounded
  application-side log loop.
- Focused tests fail on the pre-fix behavior and pass after the fix; Core,
  desktop typecheck/build, architecture, and existing connector-lab checks
  remain green.

### Non-goals

- No live Gmail token exchange, Slack WebSocket, message send, or external API
  call in automated tests.
- No token rotation or OAuth consent/scope redesign.
- No change to the user's existing `.gitignore` or unrelated connector-lab
  worktree changes.

### Gmail/Slack diagnostics final checkpoint (2026-08-31T19:15:42.5224288+09:00)

- Gmail now accepts an optional development `GOOGLE_OAUTH_CLIENT_SECRET`,
  forwards it through connect and startup hydration, and converts Google's
  missing-secret response into an actionable message without exposing values.
- Slack now walks bounded nested error causes, redacts URLs/tokens, suppresses
  duplicate SDK wrapper logs, and returns from initial startup while the SDK's
  auto-reconnect lifecycle continues under the transport owner.
- Verification: desktop Gmail tests 4/4, Slack tests 6/6, Core 125 files/655
  tests with 3 skips, integration 72/72, connector-lab 2/2, Core and desktop
  typechecks, production build, architecture check with 0 violations, and
  diff check passed.

## Current task: Webhook body mapping and workflow conversation results

Close the two gaps exposed by the first real connector-lab run. A Webhook
workflow must give its AI step the provider JSON body rather than the route
path, and a completed saved-workflow run must leave a bounded human-readable
result in the conversation session mapped to that workflow. Activity remains
the operational execution record; the conversation is the user-facing result
surface.

### Success criteria

- Webhook default AI input binds `trigger.body` ahead of `trigger.path` while
  preserving the route path as a separate trigger value.
- A Webhook payload containing `invoiceId`, `amount`, and `status` reaches the
  AI investigation prompt through the normal runtime binding seam.
- Finished saved-workflow executions append one durable assistant result to the
  workflow's mapped workspace chat, with success/failure/pending/cancelled
  status and a bounded execution reference.
- Result delivery is idempotent for one execution, does not write to another
  workflow's session, does not include raw request bodies or secrets, and does
  not change the technical execution outcome when persistence is unavailable.
- The desktop refreshes the mapped open conversation when a background result
  arrives, while Activity continues to receive its existing state broadcast.
- Focused regression tests fail on the pre-fix behavior and pass after the
  implementation; Core, desktop typecheck/build, connector-lab checks, and
  architecture checks remain green.

### Non-goals

- No new external Gmail/Slack side-effect capability in this slice.
- No replacement of Activity with chat messages or removal of execution logs.
- No raw payload transcript, credential storage, arbitrary session targeting,
  or broad chat-schema redesign.
- No UI redesign beyond the event needed to refresh the existing conversation.

## Current task: REST HTTP error propagation

Close the error-observability gap exposed by the live Acme Operations API
test. A non-2xx HTTP response must preserve its actual status and a bounded,
safe response-body preview through the local `capability.invoke` command
boundary so the user can distinguish authentication, not-found, validation,
and server failures. HTTP read failures must remain failures and must not
weaken the existing read-only, redirect, size, or credential boundaries.

### Success criteria

- A live `GET /api/v1/secure/profile` without credentials remains an HTTP 401
  from the independent REST fixture and reaches the command result as 401,
  never as 404.
- A 404/401 JSON response exposes bounded error details such as `error`,
  `resource`, or `hint` to local command chat without exposing credentials,
  raw request headers, or an unbounded body.
- `capability.invoke` and the AX command service preserve the structured error
  details while retaining the existing error status and command failure state.
- Existing successful GET/POST behavior and read-only/redirect/response-size
  protections remain unchanged.
- Focused regression tests fail before the patch and pass after it; Core,
  desktop typecheck/build, connector-lab, architecture, and whitespace checks
  remain green.

### Non-goals

- No renderer redesign or error-card visual work.
- No automatic retry policy, response-schema inference, or provider-specific
  error taxonomy beyond the bounded HTTP response details.
- No live external API, Gmail, Slack, database, or credential calls.
- No persistence of raw HTTP response bodies in execution logs or connection
  metadata.

### Baseline (2026-08-31T21:08:29.5034009+09:00)

- The connector-lab direct request to `/api/v1/secure/profile` returned HTTP
  401 with a JSON body containing `error` and `hint`; the lab recorded the
  request as `authMode: none`.
- The user-facing AX response reported `capability.invoke` error `http_404`,
  so the displayed status did not match the observed HTTP response.
- `HttpConnector` converts non-2xx responses to `{ ok: false, error }` and
  drops the already-read response body before `capability.invoke` throws the
  error string.
- Existing HTTP connector tests cover only a generic 400 failure and do not
  assert error-body or command-boundary propagation.

### Final (2026-08-31T21:25:47.5020800+09:00)

- `HttpConnector` now preserves the exact non-2xx status and exposes only a
  bounded response-body preview with status text and truncation metadata.
- The metadata crosses `capability.invoke` and the AX command issue mapper
  only for opted-in local untrusted-data contexts; command mapping strips
  response headers and applies the same body/status bounds.
- The live built Core request to the running Acme fixture returned
  `http_401` with HTTP status `401`, `Unauthorized`, and the fixture's
  `error`/`hint` JSON. No raw response was added to runtime persistence.
- Focused REST tests passed 36/36; full Core passed 669 tests with 3 skips;
  connector-lab, Webhook security, typechecks, production build,
  architecture, and diff checks passed.

## Current task: HTTP connection discovery after REST dogfood

Add a read-only `http.list` command so command chat can inspect every saved
HTTP endpoint before selecting a REST target. The result must make endpoint
identity and current readiness explicit without crossing the credential or
response-data boundaries observed during manual REST testing.

### Success criteria

- `http.list` is available in the bounded AX command catalog and is read-only.
- The command lists every persisted HTTP endpoint with its id, display label,
  base URL, authentication mode, connection state, credential readiness, and
  current default-selection information.
- The output never contains bearer/API-key tokens, passwords, raw auth headers,
  or HTTP response bodies; persisted connection errors are bounded if exposed.
- Multiple endpoints are clearly marked so a later REST request can provide an
  explicit `connectionId` instead of relying on an ambiguous default.
- Existing REST selection, read-only/write separation, redirect policy, error
  status propagation, and response-size cap remain unchanged.
- Focused command/connection tests, Core/Desktop checks, connector-lab,
  architecture, production build, and whitespace checks remain green.

### Non-goals

- No renderer/settings redesign or change to the existing connection form.
- No change to default endpoint selection semantics in `matchHttpEndpoint`.
- No public timeout/max-bytes tuning or large-response transport redesign in
  this slice. The manual 1.1MB test result is recorded as a follow-up: the
  response is capped and not printed, but command-chat projection still merits
  a separate context-size decision.
- No live external HTTP, Gmail, Slack, AI, or database calls.

### Final checkpoint (2026-09-01T08:25:59.2724457+09:00)

- Added the read-only `http.list` command to the AX schema and command catalog.
- It lists every saved HTTP endpoint with id, label, sanitized base URL,
  authentication mode, persisted credential readiness, connector state,
  usability, and the current default-selection marker. Multiple endpoints set
  `explicitConnectionIdRecommended: true` without changing selector behavior.
- URL userinfo, query, and fragment values are removed at the command boundary;
  tokens, passwords, auth headers, and response bodies are never returned.
- Updated the command-agent skill and regenerated the embedded skill so the
  agent checks `http.list` before choosing among REST targets.
- Verification: focused command/HTTP tests 32/32, full Core 129 files/670
  tests with 3 skips, Core and Desktop typechecks, connector-lab 2/2,
  architecture 0 violations, production build, and diff check passed.
- The manual 1.1MB REST response remains a successful capped/unprinted read.
  Reducing the body projected into command-chat history is intentionally a
  separate follow-up because it changes the response-data contract.

## Current task: invalid provider command boundary during DB QA

Close the command-chat boundary failure exposed by manual PostgreSQL testing.
An internal capability id such as `rdb.schema.describe` must not be accepted as
the outer AX command name, but a malformed or unsupported provider command must
be rejected as a bounded chat result instead of escaping as a raw validation
exception through `ax:sendCommandChat`.

### Success criteria

- A provider output with outer command name `rdb.schema.describe` is reproduced
  at the command-chat seam and no longer crashes the chat turn after the fix.
- The correct nested form remains `capability.invoke` with the capability id in
  `args.id`; the AX command catalog is not widened with internal capability ids.
- Codex, Claude, and direct command transport boundaries reject unsupported
  command names without leaking a raw Zod enum dump or stack trace to the user.
- Valid command/reply flows and the existing read-only RDB allowlist behavior
  remain unchanged.
- Focused regression tests, Core/Desktop checks, production build,
  architecture, and whitespace checks remain green.

### Non-goals

- No RDB capability, table allowlist, SQL, or connector behavior changes.
- No live PostgreSQL, HTTP, Gmail, Slack, AI-provider, or external side effect.
- No broad prompt redesign; only the minimal protocol clarification required by
  the confirmed boundary issue.

### Baseline (to be recorded before implementation)

- Existing command-chat and transport tests cover valid provider outputs but do
  not cover an internal capability id in the outer command field.
- The reported output reaches `AxCommandSchema.parse()` in a transport
  normalizer and escapes through the desktop IPC catch as a raw
  `invalid_enum_value` error.

### Final checkpoint (2026-09-01T09:20:31.2895811+09:00)

- Provider wire envelopes now keep command names structurally readable and the
  host performs the authoritative AX command validation after decoding.
- Codex, Claude, and direct transports reject internal capability IDs such as
  `rdb.schema.describe` with one bounded message; the command service is not
  called and `AX_COMMAND_NAMES` remains unchanged.
- The command skill explicitly distinguishes capability IDs from outer AX
  command names and shows the required `capability.invoke.args.id` shape; the
  embedded skill and packaged Electron main bundle were regenerated.
- Verification: focused transport/chat tests 20/20, Core 129 files/677 tests
  with 3 skips, Core and Desktop typechecks, production build, connector-lab
  2/2, architecture 0 violations, root Webhook security 3/3, and diff check
  passed. No live database or external provider calls were used.

## Current task: preserve PostgreSQL DATE values in RDB reads

Fix the data-fidelity regression exposed by manual PostgreSQL testing: a
PostgreSQL `date` column must cross the RDB read and command-result boundary
as its date-only value, without a timezone-induced `T15:00:00.000Z` conversion.

### Success criteria

- A PostgreSQL `DATE` value such as `2025-11-03` is returned as the exact
  date-only string at the RDB result boundary and remains unchanged when the
  result is serialized for command chat.
- PostgreSQL timestamp types keep their existing driver semantics; only the
  date-only type is corrected.
- SQLite/MySQL behavior, table/schema allowlists, row limits, and read-only
  policy remain unchanged.
- A focused regression fails before the fix and passes after it at the actual
  PostgreSQL client boundary; existing RDB and design-tool tests remain green.
- Core/Desktop checks, production build, architecture, and whitespace checks
  remain green.

### Non-goals

- No UI/UX redesign, chat persistence change, or command-protocol change.
- No SQL write capability, allowlist, row-limit, or connector policy change.
- No live external database/provider call in the evaluator; the manual Docker
  fixture remains a human validation step.
- No broad date/time localization or generic object serialization redesign.

### Baseline (to be recorded before implementation)

- Existing RDB tests cover SQLite reads and policy helpers but do not cover the
  PostgreSQL `DATE` parser configuration.
- The manual result shows a seeded `DATE` such as `2025-11-03` as
  `2025-11-02T15:00:00.000Z`, proving date-only fidelity is lost before the
  assistant's final natural-language rendering.

### Final checkpoint (2026-09-01T10:42:52.8654206+09:00)

- Root cause confirmed at the `pg` client boundary: the default OID 1082
  parser converts PostgreSQL `DATE` text to a local-midnight JavaScript
  `Date`, which JSON-serializes with a timezone shift.
- The PostgreSQL client now overrides only the text DATE parser to return the
  original `YYYY-MM-DD` string and delegates timestamp and all other types to
  the driver's existing parsers.
- Verification: focused RDB/design-tool tests 3 files/9 tests, full Core 129
  files/678 tests with 3 skips, Core/Desktop typechecks, architecture with
  zero violations, production build, and diff check passed.
- Manual PostgreSQL app validation remains: rebuild/restart the desktop app,
  query `public.customers`, and confirm `signed_up` stays date-only.

## Current task: render an HTTP connection chooser for ambiguous chat requests

Fix the manual chat regression where a request that does not name one of
multiple saved HTTP connections produces only the assistant's plain-text
question. The workspace must receive a structured chooser card, and choosing
an action must preserve the request while making the selected connection
explicit.

### Success criteria

- A multi-HTTP connection chat request without an explicit connection does not
  silently use the default endpoint.
- The command-chat/desktop boundary returns a validated `AxUiPresentation`
  with one safe action per usable saved HTTP connection; the assistant text
  may explain the pause but must not be the only interaction.
- A chooser action sends a bounded user message containing the selected
  connection identity, so the next turn can execute against that endpoint.
- Endpoint labels, ids, base URLs, authentication readiness, and action values
  do not expose tokens, passwords, authorization headers, query secrets, or
  fragments.
- Explicit connection requests, single-endpoint default behavior, `http.list`,
  read-only HTTP policy, and existing renderer card behavior remain green.
- The original manual-shaped regression fails before the patch and passes after
  it at the smallest deterministic boundary; focused tests, typechecks, build,
  architecture, whitespace, and relevant existing regressions pass.

### Non-goals

- No visual redesign of the chooser card or generic input-card redesign.
- No live HTTP, Gmail, Slack, AI-provider, database, or external side effect in
  the evaluator.
- No parsing of arbitrary assistant prose into commands or actions.
- No changes to HTTP authentication storage, endpoint editing, or unrelated
  connector behavior.

### Baseline (to be recorded before implementation)

- Existing `ui.present` results reach the renderer as cards, but a reply-only
  connection question returns no presentation metadata.
- The HTTP connector currently has a selector fallback for omitted
  `connectionId`; the chooser regression must establish the intended
  multi-endpoint boundary without weakening single-endpoint reads.

### Final checkpoint (2026-09-01T11:17:10.7312231+09:00)

- Root cause confirmed: reply-only provider output contains a natural-language
  connection question but no presentation metadata, so the desktop renderer has
  no card to display. The existing renderer/IPC card path was already capable of
  rendering validated presentations.
- The host now performs a read-only HTTP connection preflight for request-shaped
  messages. When multiple usable endpoints are present and no endpoint is
  named, it emits a bounded `HTTP 연결 선택` presentation and pauses before
  provider execution. Actions contain only the endpoint label/id and the next
  turn carries the selected id explicitly.
- The HTTP connector now rejects an omitted connection id when multiple
  endpoints are configured, while preserving the single-endpoint fallback.
  `http.list` and the capability descriptions no longer advertise a default
  endpoint for the ambiguous case.
- Verification: chooser regression 4 files/51 tests, full Core 129 files/682
  tests with 3 skips, Core/Desktop typechecks, architecture with zero
  violations, connector-lab 2/2, production build, and diff check passed.
- Manual app check remains: restart the desktop app from the fresh build and
  send `GET /api/v1/orders?status=paid 를 조회해줘. 외부 데이터 변경은 하지 마.`
  The connection chooser card should appear before the local REST result.

## Current task: remove natural-language hardcoding from dynamic chat interactions

Audit the chat interaction seams for behavior that is inferred from localized
assistant/user prose or fixed connector/action cases instead of being carried by
typed command and result metadata. Patch the confirmed extensibility bugs in
small, reversible steps while preserving intentional compatibility, security,
and presentation catalogs.

### Success criteria

- An ambiguous HTTP request reaches the command protocol; the host does not
  inspect the user's prose to preflight `http.list` or synthesize a chooser.
  A chooser is rendered only from a validated `ui.present` result whose actions
  carry the dynamic connection identities returned by commands.
- Execution-result rendering uses its typed message kind/status metadata and
  does not classify messages by localized content substring.
- Missing-input presentation uses structured issue metadata at the producer
  boundary rather than parsing a localized error sentence. Existing typed
  input controls and security boundaries remain intact.
- Intentional deterministic mappings (catalog labels, compatibility aliases,
  explicit approval markers, and bounded status copy) remain explicit and are
  covered as such; no broad rewrite or UI redesign is introduced.
- Focused red regressions fail before each confirmed fix and pass afterward;
  relevant Core/Desktop tests, typechecks, architecture, production build, and
  diff checks pass.

### Non-goals

- No visual redesign, provider replacement, or new external connector.
- No arbitrary natural-language parser, heuristic fallback, or live external
  side effect in the evaluator.
- No removal of security authorization checks, compatibility normalization, or
  static display catalogs merely because they contain mappings.
- No unrelated cleanup of the existing dirty worktree.

### Baseline (to be recorded before implementation)

- `runAxCommandChat` uses a user-message regex and a host-side HTTP preflight,
  so an ambiguous request can receive a chooser without a provider command
  round trip.
- `WorkspaceRunResultCard` and its caller classify execution results from
  localized content text even though durable messages already have
  `kind: execution_result`.
- `inputRequestsForResult` derives missing field names from a localized issue
  message and maps names to control types/labels; producer-side structured
  input metadata is not yet present.

### Final checkpoint (2026-09-01T12:20:00.1125043+09:00)

- HTTP chooser behavior is now protocol-owned: the host no longer inspects
  user prose or invents `http.list`; a provider `http.list` followed by a
  validated `ui.present` supplies dynamic endpoint actions, and the selected
  id is carried into the next invocation.
- Missing-input controls are emitted from catalog/producer metadata, and
  localized issue text is no longer parsed to manufacture renderer controls.
- Saved execution results are a typed workspace-chat projection with
  `kind: execution_result` and `executionStatus`; Activity remains the
  operational log and the chat displays the durable result.
- Action summaries, approval details, notification detection, dynamic
  capability listing/resolution, and workflow availability validation now use
  capability metadata. Ambiguous dynamic action suffixes no longer resolve by
  accident.
- Retained intentional mappings are compatibility aliases, explicit security
  gates, typed status/error copy, connector secret handling, and the fixed
  WorkflowIR trigger/presentation schema.
- Verification passed: focused structured interaction 5 files/36 tests;
  dynamic catalog/contract/IPC regression 3 files/31 tests; expanded related
  regression 8 files/74 tests; full Core 129 files/688 tests with 3 skips;
  manual webhook 3/3; connector-lab 2/2; Core/Desktop typechecks;
  architecture 0 violations; production build; and diff check.

## Current task: make multi-target job selection discoverable and atomic

Improve the recurring HTTP-to-Slack job target selection shown by the current
chat card. The normal path must query connected Slack channels through the
existing read-only `slack.channels.list` capability, expose HTTP connections
and Slack channels as bounded selectable options, and submit all selected
targets once through one review action aligned to the card's lower right.

### Success criteria

- Connected Slack channels are read through the existing guarded read gateway;
  no token, raw response, or guessed channel is rendered.
- HTTP connections and Slack channels are represented by structured option
  metadata with stable ids as values and human labels for display.
- A target-selection card submits all required selections in one follow-up
  message; it does not require one `입력` action per field.
- The normal selection card has one review action aligned to the lower right,
  preserves keyboard accessibility, and keeps the existing read-only/approval
  boundary intact.
- If a Slack channel lookup is unavailable, the product gives an explicit,
  bounded fallback instead of silently selecting a channel or pretending the
  list is complete.
- Existing generic input cards, HTTP chooser behavior, job commit approval,
  and connector/security tests remain passing.

### Non-goals

- No new Slack API capability or external connector.
- No change to Slack send authorization, workflow approval, or job semantics.
- No broad visual redesign outside the target-selection card.
- No live Slack/Gmail/HTTP side effect in tests.

### Baseline

- The supplied target-selection screenshot shows two free-text fields, each
  with its own `입력` button, while the final review action is left-aligned.
- The Slack catalog already exposes a read-only `slack.channels.list`
  capability, but job target selection does not use its result to populate
  options.
- The shared input schema has no option list and the renderer cannot submit
  multiple input values with one presentation action.

### UX checkpoint (2026-09-01T12:39:40.9583531+09:00)

- Keep the current calm AX confirmation-card visual language.
- Replace ordinary target text fields with accessible selects when options
  are available; preserve text input only as an explicit lookup failure
  fallback.
- Keep one clear primary review action at the lower right of the card.

## Current task: make one-shot sharing use typed target selection and chat results

The latest manual request asks AX to inspect paid orders, summarize the largest
ones, and share the result after the user chooses the HTTP connection and Slack
channel. The current command protocol falls back to a prose question because
target selection is implemented only for `job.propose`, while one-shot plans use
`execution.enqueue_once`. Ephemeral executions also have no workspace-session
association, so their result can remain Activity-only.

### Success criteria

- A one-shot plan with an ambiguous HTTP target or missing Slack notification
  channel returns one host-rendered, validated target card populated from the
  saved HTTP endpoints and the guarded read-only Slack channel capability.
- The card submits all selected targets in one follow-up; no external send is
  queued before the target selection is complete.
- After selection, `execution.enqueue_once` queues a plan with the selected
  stable ids and retains the existing Runtime approval gate before any external
  send.
- Pending-approval and final one-shot execution results are projected into the
  originating workspace chat, idempotently, without exposing raw provider
  payloads or creating a phantom chat.
- The existing recurring `job.propose` target card, generic input cards,
  Activity history, approval behavior, and connection/capability safety checks
  remain passing.

### Non-goals

- No user-message regex or localized prose parsing to infer commands or target
  ids.
- No new connector API, live Slack/HTTP/Gmail side effect, or automatic
  approval.
- No broad renderer redesign or change to the saved workflow semantics.
- No cleanup of unrelated dirty-worktree changes.

### Baseline (2026-09-01T16:13:10.2768443+09:00)

- The supplied manual screenshot shows a plain assistant question instead of a
  structured target card for a one-shot HTTP-to-Slack request.
- `presentationFromResult` accepts `ui.present` and `job.propose` only;
  `execution.enqueue_once` cannot publish a target presentation.
- `WorkflowRuntime` marks one-shot executions ephemeral without a workspace
  session id, and the chat result projection deliberately excludes ephemeral
  executions.

### Implementation checkpoint (2026-09-01T16:48:46.6971285+09:00)

- `execution.enqueue_once` now performs host-side target preflight from the
  actual saved HTTP endpoints and guarded read-only Slack channel listing,
  returning one typed batch card before any queue operation.
- The selected connection/channel ids are passed through the same full plan;
  HTTP GET side effects are resolved from the action method so a selected
  read-only plan is not incorrectly rejected as external.
- Ephemeral executions persist their originating workspace session id, and
  pending/final results are upserted into that chat idempotently while keeping
  Activity and approval history intact.
- The command skill, command description, renderer contract, migration path,
  deterministic E2E seam, and focused regressions were updated together.
- Verification: command 3 files/45 tests, chat-result 3 files/8 tests, full
  Core 130 files/698 tests with 3 skips, deterministic Product QA 4 scenarios,
  Core/Desktop typechecks, architecture 0 violations, production build, and
  diff check all passed.

## Current follow-up: prevent missing action parameters after one-shot summaries

The latest manual execution reached the HTTP request and AI summary, then
failed before approval with `action_params_missing`. The plan had a Slack
channel but no usable message body because the runtime's built-in AI
`conclusion` output was absent from the workflow binding contract. HTTP text
artifacts also returned a structured response object when forwarded directly
to another text input.

### Success criteria

- A one-shot plan with an AI summary and a selected Slack channel binds the
  runtime conclusion to the Slack message body before the approval gate.
- Approval remains the first point at which the external Slack connector is
  called; a pending run sends zero messages and an approved run sends one.
- A structured HTTP text response forwards its body string to a downstream
  text input instead of an object that later fails required-parameter checks.
- Existing explicit AI output bindings, action contracts, target selection,
  result projection, and connector safety regressions remain passing.

### Non-goals

- No natural-language parsing, user-specific phrase mapping, or automatic
  approval.
- No connector API or catalog policy change.
- No broad workflow refactor or cleanup of unrelated dirty-worktree changes.

### Baseline (before patch; timestamp unavailable)

- The minimized runtime regression failed: a Slack action with a selected
  channel and no explicit text returned `failed` instead of `pending_approval`.
- The existing binding contract exposed declared AI fields and generic JSON,
  but not the default runtime `conclusion` field; HTTP `response` forwarding
  retained the structured response object.

### Implementation checkpoint (timestamp unavailable)

- Added the default AI `conclusion` output to contract-driven binding
  inference, while preserving explicit custom output fields as authoritative.
- Normalized text-artifact forwarding from object-shaped connector results to
  their `text`, `body`, or `summary` string.
- Added focused binding and runtime approval regressions; all passed.

### Final verification (2026-09-01T17:13:06.2844515+09:00)

- Focused binding/contract/runtime regression passed: 3 files/62 tests.
- Command and target regression passed: 3 files/47 tests.
- Full `npm test` passed: manual Webhook 3/3 and Core 130 files/701 tests,
  with 3 skipped.
- Core and desktop typechecks, production build, architecture check, and
  `git diff --check` passed; no external connector side effect was used.
- Deterministic Product QA smoke passed 4/4 scenarios.
- The remaining dirty-worktree files are pre-existing user changes plus the
  scoped binding regression files and harness records.

## Current follow-up: keep implicit notification text bound to the actual AI conclusion

The latest manual one-shot run still reached the HTTP and AI steps but failed
with `action_params_missing` before the Slack approval gate. The remaining
runtime risk is that an AI step with optional custom string outputs can make
implicit TextArtifact inference choose an empty field instead of the built-in
conclusion that the investigation runner actually returns.

### Success criteria

- The exact HTTP GET → AI summary → selected Slack channel chain reaches
  `pending_approval` when Slack text is omitted and the AI returns a
  conclusion.
- No Slack send occurs before approval; approval resumes exactly one send with
  the conclusion text.
- Explicit AI output bindings and scheduled-job summary bindings remain
  authoritative and unchanged.
- The regression is covered at the runtime seam and existing command,
  connector, build, and type checks remain passing.

### Non-goals

- No natural-language parsing, user-specific mapping, or automatic approval.
- No connector API/catalog policy change or broad workflow refactor.
- No cleanup of unrelated dirty-worktree changes.

### Baseline (2026-09-01; exact manual-chain regression)

- The minimized HTTP → AI → Slack plan with an optional custom string output
  binds Slack text to that optional field, so the runtime fails with
  `action_params_missing` instead of waiting for approval.

### Decision rule

- Prefer the default `conclusion` only for implicit TextArtifact inference from
  an AI step; preserve an explicitly declared binding exactly as authored.

### Final verification (2026-09-01T17:36:16.7871451+09:00)

- The exact HTTP → AI → Slack regression passed: the inferred text binding now
  uses `conclusion`, the run reaches approval, and approval sends once.
- Explicit custom output binding coverage passed, as did command/target tests,
  Core and desktop typechecks, production build, full regression, architecture
  check, deterministic Product QA smoke, and `git diff --check`.
- The built Electron main bundle contains the binding fix. No live connector or
  external side effect was used during verification.

## Current follow-up: bind actions placed behind an approval node

The latest real ephemeral execution had a selected Slack channel and a
successful HTTP/AI chain, but its Slack action was placed after an explicit
`human_approval` node. Contract binding inference skipped that gated action,
leaving the canonical `text` input absent while an unrecognized `message`
parameter remained. The runtime then failed with `action_params_missing`.

### Success criteria

- The exact HTTP → AI → human approval → Slack chain infers the AI conclusion
  into the Slack `text` input even when the model emitted `message` as an extra
  natural-language parameter.
- The run waits for approval, sends nothing before approval, and resumes with
  exactly one Slack send after approval.
- Existing branch handling, explicit bindings, target selection, and connector
  safety behavior remain unchanged.

### Non-goals

- No live connector invocation, credential changes, or UI redesign.
- No broad natural-language alias system or unrelated workflow refactor.

### Decision rule

- Include approval-gated actions in binding inference when they occur after
  their upstream sources, while preserving the existing execution and approval
  semantics.

### Final verification (2026-09-01T17:51:30.3486003+09:00)

- The minimized regression reproduced the stored execution failure before the
  fix and now reaches approval with the AI conclusion bound to Slack `text`.
- The approval-gated action sends nothing before approval and exactly one
  message after approval; the selected HTTP connection and Slack channel stay
  intact.
- Full tests, typechecks, production build, architecture check, deterministic
  Product QA smoke, diff check, and debug-marker scan passed. The rebuilt
  Electron main bundle uses the corrected inference sequence.

## Current follow-up: inline approval for one-shot execution

The latest one-shot Slack run was correctly held until the user approved it
from the approval tab, but the chat only displayed the pending result text.
Make one-shot approvals actionable in the originating conversation while
keeping recurring workflow approvals in the durable approval tab.

### Success criteria

- A pending ephemeral execution projects a bounded, non-secret approval card
  into its originating chat with explicit approve and cancel actions.
- The card calls the host approval boundary directly; approval is never inferred
  from a natural-language chat message.
- Approval or cancellation replaces the pending chat result with the final
  execution status and removes the actionable card.
- Recurring workflow approvals remain approval-tab-only.
- Duplicate clicks are safe and pending approval records remain durable.
- Existing execution, command, connector, typecheck, build, and chat behavior
  remains green.

### Non-goals

- No automatic approval, natural-language permission parsing, or connector policy
  change.
- No redesign of the approval tab or unrelated chat components.
- No live Slack/Gmail/HTTP/database side effects during verification.

### Decision rule

- Reuse the existing persisted approval and host IPC boundaries. Add only a
  bounded chat projection and direct renderer actions for ephemeral runs.

### Baseline (2026-09-01T18:17:31.8865993+09:00)

- The new projection regression fails as expected: the pending ephemeral
  execution result has no `approval` metadata, so the chat has no basis for an
  inline approval card.

### Final verification (2026-09-01T18:43:22.2917254+09:00)

- Pending one-shot execution results now carry bounded, non-secret approval
  metadata and render an actionable card in the originating conversation.
- The card calls the existing host approval/rejection boundary directly;
  approval and cancellation replace the pending result in place and leave the
  durable execution/approval record available for recovery and audit.
- Recurring workflow results do not receive inline approval metadata and remain
  approval-tab-only.
- Projection/repository tests passed 2 files/17 tests, approval runtime tests
  passed 16 selected tests, and the focused bootstrap/boundary/runtime suite
  passed 5 files/55 tests.
- Full `npm test`, Core/Desktop/test typechecks, production build, architecture
  check, deterministic Product QA smoke 6/6, diff check, and debug-marker scan
  passed. No live connector side effect was used.

## Current follow-up: externalize the current UI/UX in Figma

Build an editable AX Studio UX map in the supplied Figma file so the current
product flow can be reviewed and iterated visually.

### Success criteria

- The target file contains a named UX map with editable, componentized screens
  for workspace/chat, inline one-shot approval, approval inbox, activity,
  settings/connection hub, HTTP/RDB connection detail, and workflow context.
- Screens reflect current copy, states, hierarchy, and the Lavender Control
  Room tokens; repeated controls are reusable Figma components.
- The inline approval decision path and recurring approval-tab path are shown
  as separate states.
- Figma output is validated structurally and visually with screenshots, with
  no clipped or overlapping text and no secret values.
- Existing project code/worktree remains untouched apart from harness
  documentation.

### Non-goals

- No production code redesign or connector behavior change.
- No real credential or connector data in Figma.
- No invented external design-system dependencies.

### Baseline (2026-09-01T18:59:19.4893820+09:00)

- Target node `0:1` was an empty `Page 1` with zero top-level children; no
  local variables/components existed.
- The supplied Figma file had no searchable local design-system assets or
  Code Connect files, so the design will use a local editable token/component
  foundation.

## Current follow-up: record the implemented UI in `00 Current UI`

Reproduce the current AX Studio UI in a separate Figma page named `00 Current UI`.
This is a documentation capture of the running product, not a redesign.

### Success criteria

- The supplied Figma file contains a separate page named `00 Current UI`; the
  existing `AX Studio · UX Map` page remains unchanged.
- The page contains runtime captures of the current implemented interface with
  descriptive feature/state names, including the initial empty workspace,
  loading, completed response, input required, one-shot approval pending,
  one-shot approval completed, approval inbox pending, activity pending and
  completed, settings hub, HTTP connection detail, database connection detail,
  database connection error, and Work Discovery review/ready-to-publish states.
- Captured screens preserve the implementation's current colors, copy, spacing,
  sizing, information hierarchy, control placement, and visible side panels;
  no product behavior or new UI is invented.
- Figma metadata and screenshots verify that the page is complete enough to
  inspect and that screenshots are not clipped, overlapped, or missing labels.
- No production source, tests, generated output, dependencies, credentials, or
  live connector data are changed or included.

### Non-goals

- No redesign, visual polish, new workflow, new component behavior, or product
  code change.
- No replacement of the earlier UX Map or conversion of every screenshot into
  speculative editable product components.

### Baseline (2026-09-01T19:47:21.6979158+09:00)

- The current built Electron app was launched in an isolated Product QA profile
  and direct runtime screenshots were captured for the documented states.
- The Figma file still had only the existing empty `AX Studio · UX Map` page;
  `00 Current UI` did not yet exist.

### Final verification (2026-09-01T19:57:18.9903215+09:00)

- Created `00 Current UI` as a separate Figma page with a 2-column board of 15
  direct runtime captures and descriptive feature/state labels.
- Verified all 15 capture tiles render in the Figma board, including error,
  approval, loading, input-required, activity, settings, and discovery states.
- Verified the original `AX Studio · UX Map` page remains empty and unchanged;
  no production files were edited by this recording task.

## Current follow-up: critique the recorded current UI without modifying it

Compare the 15 runtime states in the Figma `00 Current UI` page and document
evidence-backed product UX problems. Preserve `00 Current UI` as the immutable
current-state record; any visual annotations must live on a separate page named
`01 UI UX 문제점` and must be a copy-based review artifact only.

### Success criteria

- All 15 recorded screens are compared across orientation, hierarchy,
  consistency, state clarity, complexity, accessibility, and recovery.
- Findings are grouped as 높음/중간/낮음 and mapped to exact screen/state
  locations with a concrete reason and a bounded next design question.
- Independent design and implementation/detector assessments are reconciled;
  claims distinguish observed runtime evidence from source-backed inference.
- If annotations are created, `01 UI UX 문제점` contains only a copy of the
  current-state board plus issue markers/register; no product redesign is
  introduced.
- Figma page `00 Current UI`, its board, and all 15 source capture tiles remain
  unchanged; production code and connector state remain untouched.

### Non-goals

- No product code, CSS, connector policy, data, workflow, or runtime behavior
  changes.
- No visual redesign, new UI, new product state, or replacement of the current
  state record.
- No live connector calls, credentials, provider payloads, or external sends.

### Baseline (2026-09-01T20:08:31.3214392+09:00)

- Figma `00 Current UI` page `26:2` contains a 2400x6150 board with 15
  populated runtime-capture tiles; original `AX Studio · UX Map` page `0:1`
  remains empty.
- The current implementation source and isolated runtime captures are
  available for evidence; no critique page or findings register exists yet.

### Final verification (2026-09-01T20:21:38.5384825+09:00)

- Completed two independent assessments: a design review across all 15 states
  and an implementation/detector review with source-backed recovery and
  accessibility findings.
- Created `01 UI UX 문제점` with a clone of the 15-tile current-state board,
  nine severity markers, and an editable prioritized findings register.
- Verified the source board and clone both contain 15 tiles; `00 Current UI`
  remains page `26:2` with one original board and no source-tile mutation.
- Verified the original `AX Studio · UX Map` page `0:1` remains empty; no
  production files or connector side effects were changed.

## Current follow-up: shape one understandable execution flow in Figma

Design a copy-safe Figma improvement proposal for the H2, H3, and H4 findings
from `01 UI UX 문제점`: after a user requests work, they can see progress,
understand the discovered method, decide whether to approve it, and confirm
the execution result. Preserve existing product behavior and the current
interaction vocabulary where it is already meaningful.

### Success criteria

- A new Figma page named `02 개선안` presents one coherent flow from request
  through progress, method review, approval, and completion.
- The proposal makes the current step, next action, method evidence, approval
  context, and result receipt easier to understand without inventing a new
  connector, workflow, action, or product surface.
- Existing controls and concepts are reused/recomposed: progress state,
  `찾은 방법`, `중단하기`, approval, `취소`, and `실행 완료`.
- Screens and annotations are named so a reviewer can trace each proposal back
  to H2/H3/H4 and the corresponding current-state screens.
- Figma `00 Current UI` and `01 UI UX 문제점` remain unchanged; no production
  code or live connector state changes.

### Non-goals

- No product code, CSS, connector policy, workflow engine, or data changes.
- No new functionality beyond clearer ordering, grouping, copy hierarchy, and
  state continuity using existing capabilities.
- No modification, rename, deletion, or annotation of `00 Current UI` or
  `01 UI UX 문제점`.

### Shape brief (2026-09-01T20:35:43.3195064+09:00)

- Job/audience: a person delegating an ambiguous work request who needs to
  remain confident while the system investigates and pauses before an external
  side effect.
- Outcome/proof: one continuous state story—요청 접수 → 진행 중 → 찾은 방법
  검토 → 승인 대기 → 실행 완료—with a plain-language explanation before
  technical evidence.
- Selected interaction thesis: keep the existing chat/workspace shell, but make
  the run card the single source of truth for current step, method summary,
  approval context, and completion receipt.
- Boundaries: desktop Figma proposal only; use existing state/actions and
  current lavender visual language; 00/01 pages and product implementation are
  read-only.

### Final verification (2026-09-01T20:51:55.4875546+09:00)

- Created the Figma page `02 개선안` with a five-stage rail and four
  representative screens: progress, method review, approval pending, and
  execution complete.
- Verified the proposal renders without clipped or overlapping card content at
  full-board and close screen scales.
- Verified `00 Current UI` and `01 UI UX 문제점` remain read-only references;
  no product code or live connector state was changed.

## Current follow-up: build the new Workspace UI in Figma

Create a high-fidelity Figma-only proposal page named `03 새 UI`, grounded in
`02 개선안`, that retains the current Workspace capabilities while resolving
the H2/H3/H4 issues. Build the core Workspace screen first; do not change
production code or any existing Figma page.

### Success criteria

- A new Figma page named `03 새 UI` contains a polished, inspectable Workspace screen.
- The screen retains current Workspace functions: chat request/composer, messages,
  assistant response, progress/typing, execution result, inline approval actions,
  discovery/method review, source/context panel, workflow context, and relevant
  navigation.
- The layout makes current step, next action, found method, approval target/side
  effect, and completion result easy to scan.
- Repeated visual primitives are structured as local components or clearly named
  reusable groups when no library component exists.
- `00 Current UI`, `01 UI UX 문제점`, and `02 개선안` remain unchanged.
- No production source, CSS, tests, connectors, credentials, or external data are changed.

### Non-goals

- No product implementation changes.
- No new connector, workflow, action, or data capability.
- No edits, renames, or annotations on existing Figma pages.
- No invented external results or provider data.

### Final verification (2026-09-02T06:35:30.9917961+09:00)

- Created Figma page `03 새 UI` with board `70:3` and a polished Workspace
  screen `72:11` centered on the approval-pending state.
- Retained the current Workspace shell, navigation, chat/composer, request and
  response, progress rail, discovery/method review, inline approval, result
  receipt, sources/context panel, workflow context, and recovery states.
- Added five named state variants and three compact existing-capability states
  for empty, additional-input, and source-panel coverage.
- Rendered and inspected the full board, primary screen, approval card, context
  panel, and all five state variants; no clipped text or unintended overlap was
  observed.
- Verified `00 Current UI`, `01 UI UX 문제점`, and `02 개선안` remain unchanged;
  no production source or connector state was changed.

## Current follow-up: add a three-tab context panel and workflow visualization

Extend only the Figma `03 새 UI` Workspace proposal so the right context panel
clearly separates 자료, 흐름, and 워크플로우. Keep the existing execution-flow
screen as the primary state and add a workflow-tab alternate state using the
existing WorkflowPreviewPanel/WorkflowGraph capability. Do not change product
code or existing Figma pages.

### Success criteria

- The primary `03 새 UI` Workspace screen shows the three context tabs:
  자료, 흐름, 워크플로우.
- The active 흐름 state remains the current execution lifecycle and approval
  context.
- A clearly named workflow-tab alternate state shows the registered workflow graph,
  workflow status, node sequence, and a selected-node detail treatment.
- The three tabs have distinct, understandable responsibilities: source material,
  current run state, and reusable workflow structure.
- `00 Current UI`, `01 UI UX 문제점`, and `02 개선안` remain unchanged.
- No production source, CSS, tests, connectors, credentials, or external data change.

### Non-goals

- No new product behavior beyond exposing the existing workflow preview capability
  as a dedicated tab in the Figma proposal.
- No additional connector, workflow node type, action, or data capability.
- No edits to existing Figma pages.

### Final verification (2026-09-02T07:02:45.4576847+09:00)

- Extended only `03 새 UI` so the primary Workspace context panel now shows
  `자료 / 흐름 / 워크플로우`; `흐름` remains the active execution-lifecycle state.
- Added a clearly named workflow-tab alternate state with `설계 완료`, a five-step
  workflow graph (`시작 조건 → HTTP 조회 → AI 요약 → 승인 → Slack 공유`),
  selected approval detail, and a three-role explainer for the context tabs.
- Added a hidden local `WorkflowNode` component with `Kind`, `Index`, `Title`, and
  `Subtitle` properties and used five visible instances in the graph.
- Rendered and inspected the updated primary context panel, workflow alternate, and
  full `03 새 UI` board; no clipping, overlap, or exposed source component remains.
- Verified `00 Current UI`, `01 UI UX 문제점`, and `02 개선안` were not written;
  no production source, tests, connector state, credentials, or external data changed.

## Current follow-up: implement the Figma three-tab Workspace context panel

Implement the latest Figma `03 새 UI` refinement in the existing AX Studio
frontend. Separate the Workspace context panel into `자료`, `흐름`, and
`워크플로우` while preserving the existing chat, source attachment, approval,
workflow-node selection, and workflow editing behavior. Use the current
frontend as the implementation baseline and keep the change limited to the
Workspace presentation layer.

### Success criteria

- The real Workspace context panel exposes accessible `자료`, `흐름`, and
  `워크플로우` tabs.
- `자료` continues to render the existing session-scoped source panel.
- `흐름` clearly shows the current request/execution lifecycle using existing
  busy, progress, discovery, execution-result, approval, and error state data;
  it does not masquerade as the reusable workflow graph.
- `워크플로우` renders the existing `WorkflowPreviewPanel`, including graph
  selection, node detail, edit guidance, and completion behavior.
- The active tab is deterministic as a session gains or loses a workflow, and
  switching tabs never drops the current chat or workflow state.
- The panel remains readable at its resizable desktop width in light and dark
  themes, with visible focus and selected states.
- Focused frontend checks, desktop typecheck/build, and relevant regression
  checks pass.
- No Figma page, connector, credential, or external data is changed.

### Non-goals

- No redesign of the full chat/workspace shell.
- No new workflow engine, connector, node type, approval path, or execution
  capability.
- No changes to the existing Figma pages `00 Current UI`, `01 UI UX 문제점`,
  `02 개선안`, or `03 새 UI`.
- No cleanup or reversal of unrelated dirty worktree changes.

### Final verification (2026-09-02T07:31:15.0050274+09:00)

- Added the real Workspace `자료 / 흐름 / 워크플로우` tab structure while
  preserving the existing source panel and reusable WorkflowPreviewPanel.
- Added a data-driven execution-flow panel that reflects busy/progress,
  discovery review, approval, completion, cancellation, and error states without
  duplicating approval actions already shown in chat.
- Verified a real workflow-created session shows the existing workflow graph in
  the dedicated 워크플로우 tab; verified an approval-pending session shows the
  flow timeline and approval guidance in the 흐름 tab.
- Verified light and dark approval states in the built Electron app; no clipping
  or unreadable status treatment was observed.
- Focused flow/tab tests (7), desktop typecheck, and production build passed.

## Current follow-up: make the 흐름 tab reflect the real execution stage

Correct the Workspace 흐름 tab so every visible stage is driven by the actual
request, discovery, approval, and execution state. Preserve the existing
three-tab presentation and keep saved-workflow review distinct from a completed
execution. Existing Workspace conversations created before structured execution
status metadata must remain understandable when their host-generated result
message has a known status sentence but no status field.

### Success criteria

- A completed execution is shown at `실행 완료` / stage 5 in the 흐름 tab,
  including legacy host result messages with a missing structured status field
  when their app-generated status sentence is unambiguous.
- Approval pending, cancelled, failed, discovery running/review, and saved
  workflow review remain distinct and map to the correct stage.
- Each stage displays a concise, truthful label/subtitle based on the current
  state; the panel does not claim external work happened when it did not.
- The center execution result card and the 흐름 tab use the same status
  interpretation for legacy and current messages.
- The existing 자료 and 워크플로우 tabs, source attachment, graph selection/edit,
  and approval actions remain unchanged.
- Focused regression tests, desktop typecheck/build, and an Electron visual
  check pass without modifying Figma or external connector data.

### Non-goals

- No new execution capability, connector behavior, workflow node type, or
  automatic approval.
- No inference from arbitrary user/assistant prose; only the known host-generated
  execution-result format may provide a legacy compatibility fallback.
- No redesign of the full shell or changes to Figma pages.

### Verification

- Root cause confirmed: older persisted `execution_result` messages can contain
  the host-generated completion sentence without the newer `executionStatus`
  field, so the 흐름 tab previously fell back to the saved-workflow review state.
- Added a strict compatibility resolver shared by the execution result card and
  흐름 panel; arbitrary assistant prose is not inferred as an execution state.
- Focused flow tests (10), desktop typecheck, production build, deterministic
  inline-approval Product QA, and built Electron visual checks passed.
- No Figma page, connector configuration, credential, or external data was
  modified.

## Current follow-up: polish the workflow visualization

Make the existing Workspace 워크플로우 tab feel finished and easy to read while
preserving its current graph, selection, zoom/pan, minimap, node-detail, edit,
and system-step behavior. Keep the current AX Studio visual language; this is a
bounded refinement of the workflow canvas, not a new workflow feature.

### Success criteria

- The workflow canvas has a clear visual hierarchy that belongs to the existing
  light/dark AX Studio shell instead of appearing as an unrelated dark debug
  surface.
- Node names and secondary labels remain readable at the normal right-panel
  width, including the long labels seen in real workflow results.
- The graph, controls, selected-node detail, notes, and empty state remain
  contained and usable without accidental clipping or overlap at desktop and
  narrow panel sizes.
- Trigger, AI, condition, approval, system, and action nodes retain their
  semantic distinction, selection treatment, and existing interaction affordance.
- Existing workflow data, wording, graph topology, node selection/editing,
  minimap/controls, and light/dark behavior remain functionally intact.
- Focused tests, typecheck/build, detector scan, and built Electron screenshots
  pass for the polished workflow tab.

### Non-goals

- No new workflow capability, node type, connector behavior, persistence, or
  external side effect.
- No changes to the three context-tab structure, chat flow, Figma pages, or
  unrelated shell surfaces.

### Verification

- Polished only the existing workflow canvas presentation: AX Studio light/dark
  surfaces, scoped grid and edge colors, semantic node styling, readable
  two-line labels, contained graph height, and clearer detail/note surfaces.
- Preserved graph topology, node selection/editing, zoom/pan, minimap/controls,
  node-detail behavior, system steps, empty state, and workflow data wiring.
- Built Electron light and dark workflow-created screens were inspected; the
  graph loaded at 520px with no observed clipping or overlap.
- Focused WorkspaceContextPanel tests (10), desktop typecheck, and production
  build passed.
- Impeccable detector reported only the pre-existing splitter
  `width`-transition warning at `workflow.css:65`; no new workflow-canvas
  finding was reported.
- No Figma page, connector configuration, credential, semantic, or external
  data was modified.

## Current follow-up: harden and freeze a local demo release candidate

Audit the current AX Studio implementation end to end and prepare a
reproducible local Windows demo release candidate. Treat the existing product
surface and current worktree as the scope; do not add new capabilities while
closing release-blocking defects and recording known limitations.

### Success criteria

- The current product surface is inventoried across chat/session, 자료,
  연결, Work Discovery, workflow, approval, execution, activity, settings,
  and packaging.
- Core unit/integration tests, deterministic Electron Product QA, connector
  seam checks, typecheck, architecture checks, and production build pass.
- Safe desktop workflows are exercised for new chat/reply, session isolation,
  source attachment, connector selection, workflow review, approval,
  cancellation/failure presentation, completed execution, discovery
  clarification/publication, and light/dark rendering.
- Any release-blocking failure is reproduced, fixed surgically, and covered by
  a regression check; non-blocking limitations are recorded explicitly.
- A Windows demo package is built locally, its expected files are present, and
  no external connector side effect or public upload is performed.
- The final scope contains no Figma changes, secret/credential exposure,
  external data mutation, or unrelated cleanup.

### Non-goals

- No new product capability, connector integration, workflow node, AI
  provider, or redesign.
- No real Gmail/Slack sending, remote API mutation, database mutation outside
  disposable local fixtures, or public release/upload.
- No destructive cleanup or reset of the existing dirty worktree.
- No claim that a local demo candidate is production-ready for general users
  without a separate security, signing, distribution, and support review.

### Verification

### Final verification (2026-09-02T09:19:35.4420188+09:00)

- The release audit passed across the current safe product surface: Core 130
  files/705 tests passed with 3 skips, integration 72/72, connector seam 2/2,
  deterministic Product QA full 61/61 and smoke 19/19, with zero defects.
- The first GitHub Actions run exposed a release-packaging omission: two new
  Product QA scenario fixtures were present locally but ignored by the
  repository's broad `test/` rule. The fixtures were added explicitly, and the
  subsequent GitHub Actions verification passed.
- Core evaluation passed 11/11, desktop TypeScript checking and the production
  build passed, dependency architecture reported zero violations across 513
  modules and 1,823 dependencies, and Knip reported no issues.
- The Windows NSIS installer and unpacked build were generated successfully;
  the packaged app launched with isolated data and rendered its first screen.
  The installer is `AX Studio Setup 0.1.0.exe` (106,127,243 bytes) and the
  unpacked executable is `AX Studio.exe` (190,557,184 bytes).
- No product-code failure was found; the only release-blocking omission was
  corrected by including the missing fixtures. The candidate is now frozen
  without Figma changes, external side effects, secret exposure, destructive
  cleanup, or public upload.
- Known limits remain explicit: live AI/account paths and real Gmail/Slack/HTTP
  delivery or remote/database mutation were not run; eight side-effect
  scenarios remain intentionally excluded from the deterministic coverage
  denominator. The demo installer is unsigned and uses Electron's default icon.

## Current task: make PDF form round-trip editing reliable

Validate and harden the document write path for a real report form:
`PDF → editable HTML → HTML edit → PDF export`. The converted HTML must retain
the report's page-oriented structure, tables, and visual evidence well enough
for a user to edit the report and export a readable PDF again. The export must
use the intended A4 geometry instead of Chromium's Letter default.

### Success criteria

- Docling PDF-to-HTML export embeds visual evidence and emits an explicit
  page-oriented HTML representation suitable for editing.
- HTML edited after conversion is reflected in the exported PDF.
- Exported PDFs use A4 portrait geometry, print backgrounds, and remain valid
  readable PDFs.
- A real local Electron round-trip check validates edited text, table content,
  embedded visual content, PDF geometry, and output metadata.
- Existing document-engine, Core, desktop typecheck/build, and safe Product QA
  checks remain green.
- No external connector side effect, credential, user data, Figma page, or
  unrelated UI behavior is changed.

### Non-goals

- Reconstructing the source PDF's exact vector coordinates or making arbitrary
  PDF files fully WYSIWYG-editable in this slice.
- Adding a general-purpose rich-text editor or new report template language.
- Changing the read/ingest pipeline except where a shared parser contract is
  demonstrably required for this write path.

### Baseline (2026-09-02T10:53:04.2052592+09:00)

- The real `D:\\ax_test\\AX_Studio_PDF_Engine_Test.pdf` is 6 pages, A4, and
  contains native text, a structured table, a raster chart, a scanned memo,
  and a mixed evidence page.
- Current `auto` resolved to Docling 2.120.3 and reported 6 pages, but its
  default HTML export had no `<img>` tags and no page split. The core
  `html.render` step found zero Handlebars slots and left that static HTML
  unchanged for report data.
- The current Electron export accepted an edited HTML string and produced a
  valid PDF with the edit, but the result was 3 Letter pages and omitted the
  chart/scanned visual evidence. The basic fallback was worse: mojibake text,
  flattened table content, missing images, and 3 Letter pages.

### Implementation checkpoint

- The write-side Docling export now assembles one editable HTML section per
  source PDF page, requests embedded images, preserves image-only pages from
  the source PDF, and invalidates older write-template caches. Electron PDF
  export now requests A4, CSS page sizing, and background graphics. The HTML
  render adapter consumes the imported template when no explicit template is
  supplied.

### Final verification

Completed 2026-09-02T11:21:23.8229896+09:00.

- The supplied six-page mixed-format PDF passed the real Docling conversion:
  six editable page sections, three embedded visual elements, and one
  structured table were present in the generated HTML.
- The HTML edit marker survived the real Electron Chromium print bridge.
  The output is a valid six-page A4 portrait PDF at 594.96 × 841.92 points,
  and all six rendered pages were visually inspected without clipping,
  broken images, missing backgrounds, or unreadable table regions.
- Document-engine unittest passed 19/19, Core passed 707 with 3 skips,
  focused document-write tests passed 9/9, desktop typecheck passed, and the
  production desktop build passed.
- `html.render` now keeps `templateHtml` in the flow when no explicit
  template is supplied; explicit templates still take precedence.
- Remaining limitation: PDF-to-HTML is semantic/page-oriented rather than
  exact vector-coordinate reconstruction, and a converted static PDF has no
  automatically inferred Handlebars data slots.

## Current task: build a source-authoritative PDF form pipeline

Implement a generic PDF form workflow without deriving production behavior
from `D:\\ax_test\\테스트양식.pdf`. The supplied file is reserved for the final
real-document integration check only.

### Success criteria

- A document-engine form-template contract represents page geometry, field
  type, source/provenance, confidence, and editable values without hard-coded
  labels or coordinates from one fixture.
- The analyzer chooses the safest available branch in this order: existing
  AcroForm widgets, positional text/geometry for digital PDFs, and OCR/layout
  candidates for image/scanned PDFs.
- The canonical export writes values onto a copy of the original PDF and
  preserves the source PDF as the visual authority; HTML is a preview/editing
  surface, not the canonical document.
- Synthetic fixtures cover AcroForm, positional digital, and image/OCR
  branches, including value round-trip and source immutability checks.
- The final integration check runs the generic pipeline against
  `D:\\ax_test\\테스트양식.pdf` only after implementation and records any
  confidence/manual-review limitations honestly.
- Existing document-engine, Core, desktop typecheck/build, and safe Product QA
  checks remain green.

### Non-goals

- No field names, labels, or coordinates copied from the supplied test form
  into production code.
- No arbitrary rich-text PDF editor or claim of pixel-perfect conversion for
  every PDF.
- No external connector side effects, credential changes, Figma edits, or
  unrelated UI redesign.

### Current task verification (2026-09-02T12:33:32.9644461+09:00)

- The generic pipeline passed synthetic coverage for AcroForm widgets, digital
  geometry, OCR geometry candidates, positional placeholders, source hashing,
  and worker persistence/fill.
- The final real-document check was run only after implementation. It used the
  generic OCR/geometry path, detected six reviewable regions, and produced a
  one-page filled PDF while preserving the source hash and page geometry.
- The rendered result was visually inspected. OCR/layout candidates remain
  review-required (confidence: 0.72); the pipeline does not silently treat
  scanned-form guesses as trusted semantic mappings.
- Core tests, focused document-write tests, document-engine tests, desktop
  typecheck/build, Product QA smoke, architecture, evaluation, and boundary
  checks passed.

## Current task: make the canonical PDF form writer PyMuPDF-backed

Keep the generic PDF form contract and change only the canonical write engine
so values are written through PyMuPDF onto a copy of the original PDF. Keep
semantic PDF ingestion on the Docling path and keep the PDF-to-HTML editing
route separate.

### Success criteria

- Native AcroForm widgets and geometry/OCR overlay fields are written through
  PyMuPDF, with no silent success when a requested native field is not applied.
- The result identifies the writer as `pymupdf`, preserves the source hash and
  page geometry, and never overwrites the source PDF.
- Korean text in a real generic form output is readable when a system CJK font
  is available, without copying fixture-specific labels or coordinates.
- Synthetic form tests, the reserved final real-form check, document-engine
  tests, focused Core tests, and desktop checks remain green.
- Documentation states the boundary between Docling semantic reads,
  geometry/OCR form analysis, PyMuPDF form writes, and Chromium HTML export.

### Non-goals

- No changes to the Figma file, product UI, connectors, credentials, or
  external delivery.
- No fixture-specific mapping for `D:\\ax_test\\테스트양식.pdf`.
- No replacement of the separate PDF-to-HTML semantic editing route.

### Baseline (2026-09-02T12:54:06.3589146+09:00)

- Synthetic PDF form tests passed 8/8, but the canonical form writer still
  used `pypdf` plus `reportlab` overlays and had no PyMuPDF dependency.
- The real-form path had no writer-engine assertion; silent native-widget
  non-application was not explicitly rejected.

### Verification (2026-09-02T13:19:34.1393500+09:00)

- PyMuPDF 1.28.2 is installed in the document-engine venv and declared in
  `requirements.txt`; `pip check` reports no broken requirements.
- Synthetic form coverage is 9/9, document-engine coverage is 28/28, focused
  Core document-write coverage is 9/9, the full Core suite is 707 passed with
  3 skipped, Core eval is 11/11, and desktop typecheck/build pass.
- The reserved real-form run reports `writerEngine: "pymupdf"`, uses the
  generic OCR geometry branch with review required, preserves the source hash
  and 595.5 × 842.25 page geometry, and renders the Korean value without
  clipping. Native AcroForm output was also visually checked.
- Digital placeholder output removes the source token before writing the
  value; the failure guard rejects a native field that was not applied.

## Current task: production hardening of the PDF form pipeline

Push the PDF-first implementation as far as the current architecture safely
allows. Preserve the engine boundary—Docling for semantic PDF reads,
geometry/OCR for locating form regions, and PyMuPDF for canonical writes—while
making the form path robust enough for real multi-page work instead of only a
single happy-path document.

### Success criteria

- Native AcroForm text, checkbox/radio, and choice fields are covered by
  deterministic tests; overlay fields support multi-page and rotated source
  pages without changing the source geometry.
- A saved PDF is reopened and verified before it replaces the requested
  output. The result exposes `verified: true`; overflow, unsupported fields,
  missing native widgets, and mismatched templates fail explicitly.
- Digital placeholders are replaced rather than overlaid, multiline text is
  bounded by its detected rectangle, and source/page hashes remain safe.
- The reserved real form remains generic and review-gated; no fixture labels,
  coordinates, or special cases enter production code.
- Existing document-engine, Core, desktop, and evaluation checks remain green.

### Non-goals

- No DOCX/XLSX implementation, product UI redesign, connector delivery, or
  external side effect.
- No claim that OCR can infer business semantics without review; low-confidence
  geometry remains explicitly review-required.
- No fixture-specific mapping for `D:\\ax_test\\테스트양식.pdf`.

### Baseline (2026-09-02T13:32:10.7404465+09:00)

- Current synthetic form coverage passes 9/9 and the reserved real form can be
  analyzed through the generic OCR geometry path.
- The writer is PyMuPDF-backed, but it does not yet reopen and verify the
  temporary output, and the result has no `verified` status.
- Synthetic coverage does not yet exercise multi-page/rotation, checkbox/radio
  overlay behavior, choice widgets, or explicit text-overflow rejection.

### Verification (2026-09-02T14:04:59.8285061+09:00)

- Added deterministic coverage for native checkbox/radio/choice fields,
  name- and id-addressed radio groups, option validation, four page rotations,
  multi-page overlay writes, rotated overlay marks, overflow rejection, source
  overwrite protection, and template schema/hash/geometry validation.
- The writer now reopens the temporary PDF before publication, verifies page
  count/size/rotation and requested field values, checks that the source did
  not change during the fill, and returns `verified: true` only after those
  checks pass.
- Final checks pass: PDF form tests 13/13, document-engine tests 32/32,
  focused Core document-write tests 9/9, full Core 707 passed with 3 skipped,
  Core eval 11/11, `pip check`, desktop typecheck/build, and the reserved real
  form run. The real run remains generic OCR geometry with confidence 0.72 and
  `requiresReview: true`; its output reports PyMuPDF, verified output, source
  preservation, and one rendered page.
- The final real output was visually inspected for preserved layout, readable
  inserted text, and absence of clipping. No supplied-form label, coordinate,
  or special-case mapping was added to production code.

### Verification (2026-09-02T14:36:28.5628440+09:00)

- Unicode PDF form coverage passes 18/18. It covers rendered native Korean
  text, unsupported-glyph rejection without publishing output, missing and
  partial explicit-font rejection, valid font round-trip, and the embedded
  CJK fallback path.
- The full document-engine suite passes 37/37, focused Core document-write
  tests pass 9/9, and `pip check` reports no broken requirements.
- The reserved `D:\\ax_test\\테스트양식.pdf` run passes with a verified PyMuPDF
  output, exact Korean value extraction, unchanged source hash, preserved
  595.5 × 842.25 page geometry, and one Poppler-rendered page with readable
  glyphs.
- Core full tests/eval, desktop typecheck/build, harness YAML parsing, and
  `git diff --check` pass. The production boundary search found no supplied
  test-form labels, coordinates, or mappings.

## Current task: PDF Unicode font integrity

Prevent filled PDFs from silently publishing garbled or missing non-ASCII
text. Keep the existing source-authoritative split: Docling remains the
semantic reader, geometry/OCR remains the locator, and PyMuPDF remains the
canonical writer.

### Success criteria

- Overlay text values with non-ASCII characters use a validated font with the
  required glyph coverage; no silent fallback to a built-in ASCII-only font.
- Invalid, missing, or insufficient fonts fail with a structured, actionable
  error before a partial output is published.
- Native AcroForm text/choice values are checked for rendered Unicode text,
  not only their logical widget value, so stale or garbled appearances fail.
- Deterministic regression tests cover Korean/Unicode overlay and native paths,
  missing-font rejection, source immutability, and the existing ASCII paths.
- The reserved real-form check still passes and its Korean output remains
  visibly readable after rendering.
- Existing document-engine, Core, desktop, and evaluation checks remain green.

### Non-goals

- No change to the PDF-to-HTML semantic editing route, UI, connectors,
  credentials, external delivery, or DOCX/XLSX support.
- No fixture-specific font, label, coordinate, or mapping for
  `D:\\ax_test\\테스트양식.pdf`.
- Do not replace a native form with an unreviewed visual approximation merely
  to hide a font failure; unsupported native appearances must fail explicitly.

### Baseline (2026-09-02T14:16:23.2356505+09:00)

- The overlay writer selects the first existing system font and otherwise
  silently falls back to built-in `helv`; it does not validate Unicode glyph
  coverage.
- Native widget verification checks the logical field value but does not check
  the rendered text/appearance for non-ASCII values.
- Existing tests cover ASCII native and overlay values, while the reserved real
  form happens to render Korean on this host because `malgun.ttf` is present.
- The current form suite is green, but a missing-font or native-glyph regression
  can pass logical verification without proving readable output.

## Current task: document-engine structural refactor

Refactor the document-engine PDF form writer into focused internal modules and
folders while preserving the existing public import contract and behavior. The
first slice targets the longest, most coupled implementation file; broader
repository cleanup remains staged until this slice is verified.

### Success criteria

- `write.pdf_form` remains the stable external seam for the worker and existing callers.
- PDF form analysis, template persistence, font resolution, overlay writing,
  native widget writing, and output verification have separate internal modules
  with no import cycle.
- No production module in the refactored PDF form implementation exceeds 650
  lines, and the compatibility facade stays under 100 lines.
- Existing behavior and structured error messages remain unchanged.
- PDF form, full document-engine, focused Core document-write, full Core,
  evaluation, desktop typecheck/build, and whitespace checks remain green.
- No fixture-specific labels, coordinates, mappings, UI, connector, credential,
  or external-delivery changes are introduced.

### Non-goals for this slice

- No PDF behavior, schema, worker protocol, or public TypeScript contract changes.
- No DOCX/XLSX implementation, Figma/UI change, connector change, or broad
  parser rewrite.
- No opportunistic formatting or unrelated refactors in the dirty worktree.

### Baseline (2026-09-02T14:51:07.9536849+09:00)

- The PDF form writer is a 1,672-line monolith; the worker imports its public
  functions directly and the form tests also cross its private test seams.
- PDF form tests pass 18/18, the full document-engine suite passes 37/37, the
  focused Core document-write suite passes 9/9, full Core passes 707 with 3
  skipped, evaluation passes 11/11, desktop typecheck/build pass, and diff
  whitespace is clean apart from normal CRLF normalization warnings.
- The import smoke check passes when the document-engine source path is on
  `PYTHONPATH`; the structural shape check fails as expected because the
  facade is 1,672 lines and the implementation folder does not exist yet.

### Final checkpoint (2026-09-02T15:18:03.7431425+09:00)

- Replaced the monolithic PDF form implementation with a 27-line stable
  `write.pdf_form` facade and focused modules under `write/pdf_form_engine`.
- Analysis, template persistence, runtime/PyMuPDF access, font resolution,
  overlay writing, native widget writing, filling, and verification now have
  separate implementation modules; the largest is 528 lines.
- The public worker import contract and existing private test seams are
  preserved. Synthetic, full document-engine, real-form, Core, evaluation,
  desktop, dependency, and whitespace checks are green.

## Current task: repository module structure refactor — phase 2

Continue the structural cleanup with the Docling PDF ingestion adapter. Keep
`adapters.docling.DoclingAdapter` as the external seam while moving conversion,
document-item extraction, page/image handling, OCR policy, and table repair
into focused internal modules. The broader Core refactor remains staged until
this slice is verified.

### Success criteria

- `adapters.docling.DoclingAdapter` and existing helper imports keep their
  current behavior and error modes.
- Docling conversion, structure extraction, visual page handling, OCR policy,
  and table repair have separate internal modules with one-way dependencies.
- The `adapters.docling` facade is <=100 lines and each production module under
  `adapters/docling_engine` is <=450 lines.
- Full document-engine, focused Core document-write, and project regression
  checks remain green.
- No fixture-specific labels, coordinates, mappings, UI, connector,
  credential, or external-delivery changes are introduced.

### Non-goals for this slice

- No behavior, manifest schema, worker protocol, or TypeScript contract changes.
- No Core command/runtime refactor until this adapter slice is independently
  verified.
- No DOCX/XLSX work, UI/Figma changes, or opportunistic formatting.

### Baseline (2026-09-02T16:27:53.6958172+09:00)

- `packages/document-engine/src/adapters/docling.py` is a 596-line module
  containing conversion, item extraction, visual page handling, OCR policy,
  table repair, and adapter orchestration.
- The existing Docling interface and private table/OCR helper imports pass;
  full document-engine tests pass 37/37 and focused Core document-write tests
  pass 9/9.
- The structural shape check fails as expected because the facade is 596 lines
  and `adapters/docling_engine` does not exist yet.

### Adjacent command-contract extraction

During the same bounded cleanup, the 950-line Core command service contained a
large static command contract that did not depend on the service instance. It
was moved to `agent/commands/contract.ts`; `AxCommandService` remains the
stable interface and is now 542 lines. Command service, chat, and job tests
pass 58/58 and Core type checking passes.

## Current task: repository module structure refactor — phase 3

Separate the Core workflow execution implementation from the public
`WorkflowRuntime` facade. Keep the current queue, active-state, connector,
observer, execution-result, and approval-resume interface while moving the
large execution and resume implementation behind an internal execution seam.

### Success criteria

- `WorkflowRuntime` remains the stable caller-facing interface with unchanged
  execution, approval, queue, and observer behavior.
- Normal workflow execution, sequence/branch traversal, output-contract
  checks, repair proposal recording, and approval resume live in a focused
  internal execution module.
- `runtime/engine.ts` is <=300 lines and the internal runner is <=650 lines.
- Runtime tests, full Core/evaluation checks, document-engine regressions,
  desktop typecheck/build, and whitespace checks remain green.
- No workflow schema, approval policy, connector behavior, or UI changes are
  introduced.

### Non-goals for this slice

- No changes to execution semantics, persistence format, error codes, or
  public TypeScript types.
- No additional runtime abstractions beyond the seam required for this move.
- No refactor of the remaining large Core modules until this slice is green.

### Baseline (2026-09-02T16:39:36.1083125+09:00)

- `packages/core/src/runtime/engine.ts` is 708 lines and combines the public
  lifecycle facade with normal execution, branch traversal, and approval
  resume.
- Runtime engine/manual tests pass 44/44 and Core type checking passes.
- The structural shape check fails as expected because the facade is 708 lines
  and `runtime/execution` does not exist yet.

### Final checkpoint (2026-09-02T16:50:35.9690445+09:00)

- Replaced the 708-line runtime module with a 132-line `WorkflowRuntime`
  lifecycle facade and a 607-line internal execution runner.
- Normal execution, sequence/branch traversal, output-contract checks, repair
  proposal recording, and approval resume remain behind the existing runtime
  interface; no workflow or approval semantics changed.
- Runtime tests pass 44/44, full Core passes 707 with 3 skipped, evaluation
  passes 11/11, document-engine passes 37/37, desktop typecheck/build pass,
  and whitespace checks are clean apart from normal CRLF normalization
  warnings.

## Current task: repository module structure refactor — phase 4

Separate the Core Work Discovery pipeline, snapshot recovery, and display
helpers from the public `WorkDiscoveryService` facade. Keep the existing
session lifecycle, command behavior, checkpoint recovery, clarification, and
publication semantics unchanged.

### Success criteria

- `WorkDiscoveryService` remains the stable caller-facing interface with
  unchanged start, inspect, wait, cancel, retry, answer, and publish behavior.
- Discovery execution, persisted snapshot loading/identity, and display
  formatting live in focused internal modules with one-way dependencies.
- `work-discovery/service.ts` is <=450 lines; `pipeline.ts` is <=300 lines;
  `view.ts` and `snapshot.ts` are each <=100 lines.
- Work Discovery tests, full Core/evaluation checks, document-engine
  regressions, desktop typecheck/build, and whitespace checks remain green.
- No discovery state schema, source behavior, workflow publication behavior,
  UI, connector, credential, or external-delivery changes are introduced.

### Non-goals for this slice

- No changes to discovery state transitions, budgets, source inventory,
  replay, clarification, or publication semantics.
- No new service abstraction or public TypeScript contract.
- No refactor of remaining large modules until this slice is independently
  verified.

### Baseline (2026-09-02T16:52:58.2932251+09:00)

- `packages/core/src/work-discovery/service.ts` is 670 lines and combines
  session lifecycle, display helpers, snapshot recovery, and the full
  discovery pipeline.
- Work Discovery service tests pass 12/12 and Core type checking passes.
- The structural shape check fails as expected because the public service is
  still the monolithic implementation.

### Final checkpoint (2026-09-02T16:58:00.0744402+09:00)

- Reduced `WorkDiscoveryService` from 670 lines to a 433-line public facade.
- Moved discovery execution into `work-discovery/pipeline.ts`, persisted
  snapshot loading/identity into `snapshot.ts`, and display formatting into
  `view.ts`; the focused modules do not import the facade.
- Work Discovery tests pass 34/34 including the north-star end-to-end flow;
  Core passes 707 with 3 skipped, evaluation passes 11/11, document-engine
  passes 37/37, desktop typecheck/build pass, and whitespace checks pass.

## Current task: repository module structure refactor — phase 5

Separate the Core AI investigation input preparation, evidence/data policy,
output validation, and investigation loop from the public
`runtime/ai-investigation.ts` seam. Preserve the current investigation
read-limit, cloud-data policy, document evidence, output contract, and
provider behavior.

### Success criteria

- Existing `runAiDecision`, `buildInvestigationUser`, `evaluateCondition`, and
  `resolveStepParams` imports keep their current behavior and error modes.
- Document/email/image input preparation, data-policy/evidence checks, output
  schema/logging, and the investigation loop live in focused internal modules
  with one-way dependencies.
- `runtime/ai-investigation.ts` is <=350 lines and each production module
  under `runtime/investigation` is <=350 lines.
- AI investigation, capability-read, webhook-body mapping, runtime, full Core,
  evaluation, document-engine, desktop typecheck/build, and whitespace checks
  remain green.
- No provider, security policy, workflow schema, connector, UI, credential,
  or external-delivery behavior changes are introduced.

### Non-goals for this slice

- No changes to prompt wording, data filtering, evidence rules, read limits,
  output schema semantics, or condition evaluation.
- No additional investigation abstraction beyond the internal seams required
  to separate input, policy, output, and orchestration responsibilities.
- No refactor of remaining large modules until this slice is independently
  verified.

### Baseline (2026-09-02T16:59:33.3252871+09:00)

- `packages/core/src/runtime/ai-investigation.ts` is 669 lines and combines
  input extraction, cloud-data policy, evidence validation, output logging,
  and the investigation loop.
- AI investigation, capability-read, and webhook-body mapping tests pass
  19/19; Core type checking passes.
- The structural shape check fails as expected because the public module is
  still the combined implementation.

### Final (2026-09-02T18:16:29.1375913+09:00)

- Kept the existing 'agent/commands/contract.ts' interface as a 14-line
  facade and moved command definitions, generic helpers, HTTP safety,
  quality-log interpretation, and capability presentation into focused
  modules.
- Command, chat, job-registration, schema, and transport tests pass 68/68;
  full Core passes 707 with 3 skipped, evaluation passes 11/11,
  document-engine passes 37/37, desktop typecheck/build pass, and whitespace
  checks pass.
- No command names, lifecycle metadata, payloads, response shapes, redaction
  limits, quality codes, capability values, or public import paths changed.

### Final (2026-09-02T18:10:07.3249755+09:00)

- Kept the existing 'store/db.ts' interface as a 10-line facade and moved
  database contracts, migration application, sql.js persistence, and backend
  selection into focused internal modules.
- Database migration and workflow repository tests pass 10/10; full Core
  passes 707 with 3 skipped, evaluation passes 11/11, document-engine passes
  37/37, desktop typecheck/build pass, and whitespace checks pass.
- No migration SQL, legacy compatibility, fallback policy, persistence timing,
  readonly behavior, or public import paths changed.

### Final checkpoint (2026-09-02T17:04:19.2258840+09:00)

- Reduced `runtime/ai-investigation.ts` from 669 lines to a 231-line public
  facade.
- Moved document/email/image input preparation, output schema and bounded
  logging, evidence/data policy, and prompt construction into four focused
  modules under `runtime/investigation`.
- AI investigation, capability-read, webhook binding, and runtime tests pass
  51/51; full Core passes 707 with 3 skipped, evaluation passes 11/11,
  document-engine passes 37/37, desktop typecheck/build pass, and whitespace
  checks pass.

## Current task: repository module structure refactor — phase 6

Separate workflow binding port discovery, static inference, runtime value
resolution, and contract checks from the public `workflow/bindings.ts` seam.
Preserve the current automatic binding decisions, branch guarantees, trigger
mapping, parameter application, and contract compatibility behavior.

### Success criteria

- Existing binding exports keep their current behavior and import paths,
  including AI decision bindings, workflow inference, runtime application, and
  contract checks.
- Port discovery/selection, binding inference, runtime resolution/application,
  and contract validation live in focused internal modules with one-way
  dependencies.
- `workflow/bindings.ts` is <=100 lines and each production module under
  `workflow/bindings` is <=350 lines.
- Binding, AI investigation, runtime, full Core/evaluation, document-engine,
  desktop typecheck/build, and whitespace checks remain green.
- No workflow schema, connector, approval, provider, UI, credential, or
  external-delivery behavior changes are introduced.

### Baseline (2026-09-02T17:05:46.3912726+09:00)

- `packages/core/src/workflow/bindings.ts` is 635 lines and combines output
  port discovery, inference, runtime resolution, parameter application, and
  contract validation.
- Binding, AI investigation, runtime, and canvas compile tests pass 66/66;
  Core type checking passes.
- The structural shape check fails as expected because the public module is
  still the combined implementation.

### Final checkpoint (2026-09-02T17:10:42.7411801+09:00)

- Reduced `workflow/bindings.ts` from 635 lines to a 21-line public export
  facade.
- Moved output-port discovery and source selection, static branch-aware
  inference, runtime binding resolution/application, and contract checks into
  four focused modules under `workflow/bindings`.
- Binding, AI investigation, canvas compile, and runtime tests pass 66/66;
  full Core passes 707 with 3 skipped, evaluation passes 11/11,
  document-engine passes 37/37, desktop typecheck/build pass, and whitespace
  checks pass.

## Current task: repository module structure refactor — phase 7

Separate workflow contract structure validation from branch-aware input/output
contract validation while keeping `workflow/contract-validator.ts` as the
stable public seam. Preserve trigger checks, connector availability checks,
graph-cycle detection, reference validation, branch guarantees, and
persist-time action parameter validation.

### Success criteria

- Existing `validateWorkflowContracts`, `validateWorkflowForPersistence`,
  `validateWorkflowContractsOrThrow`, and exported validation types keep their
  current behavior and import paths.
- Shared validation types, workflow structure checks, and sequence contract
  checks live in focused internal modules with one-way dependencies.
- `workflow/contract-validator.ts` is <=150 lines; structure is <=450 lines;
  sequence is <=300 lines; shared types are <=100 lines.
- Contract validation, adapters, canvas, job registration, runtime, full
  Core/evaluation, document-engine, desktop typecheck/build, and whitespace
  checks remain green.
- No workflow schema, binding, connector, approval, provider, UI, credential,
  or external-delivery behavior changes are introduced.

### Non-goals for this slice

- No changes to issue codes/messages, validation ordering, branch semantics,
  connector checks, or persistence rules.
- No new public validation abstraction beyond the existing re-export facade.
- No refactor of remaining large modules until this slice is independently
  verified.

### Baseline (2026-09-02T17:12:23.3241777+09:00)

- `packages/core/src/workflow/contract-validator.ts` is 633 lines and
  combines graph/trigger/action structure checks with branch contract walks.
- Contract validator, adapter, canvas, job-registration, and runtime tests
  pass 69/69; Core type checking passes.
- The structural shape check fails as expected because the public module is
  still the combined implementation.

### Final checkpoint (2026-09-02T17:18:19.7566436+09:00)

- Reduced `workflow/contract-validator.ts` from 633 lines to a 56-line public
  facade.
- Moved structure checks, branch-aware sequence checks, and shared validation
  types into focused modules under `workflow/contract-validation` without
  changing validator exports or behavior.
- Contract validation, adapters, canvas, job registration, and runtime tests
  pass 69/69; full Core passes 707 with 3 skipped, evaluation passes 11/11,
  document-engine passes 37/37, desktop typecheck/build pass, and whitespace
  checks pass.

## Current task: repository module structure refactor — phase 8

Separate job registration contracts, target selection, workflow compilation,
presentations, and propose/commit orchestration from the public
`agent/commands/job-registration.ts` seam. Preserve the current job draft,
target discovery, approval, persistence, and run-once behavior.

### Success criteria

- Existing job-registration exports and command behavior keep their current
  behavior and import paths.
- Argument coercion/schema/types, HTTP/Slack target selection, workflow
  compilation, UI presentations, and propose/commit orchestration live in
  focused internal modules with one-way dependencies.
- `agent/commands/job-registration.ts` is <=160 lines and each production
  module under `agent/commands/job-registration` is <=350 lines.
- Job registration, chat, command service, workflow gateway, runtime, full
  Core/evaluation, document-engine, desktop typecheck/build, and whitespace
  checks remain green.
- No job schema, target precedence, approval policy, persistence semantics,
  connector behavior, UI, credential, or external-delivery behavior changes.

### Non-goals for this slice

- No changes to coercion rules, input IDs/labels, target selection precedence,
  confirmation wording, workflow shape, or run-once behavior.
- No new public job-registration abstraction beyond the existing re-export
  facade.
- No refactor of remaining large modules until this slice is independently
  verified.

### Baseline (2026-09-02T17:22:59.5741812+09:00)

- `packages/core/src/agent/commands/job-registration.ts` is 651 lines and
  combines contracts, target selection, compilation, presentations, and
  propose/commit orchestration.
- Job registration, chat, and command service tests pass 58/58; Core type
  checking passes.
- The structural shape check fails as expected because the public module is
  still the combined implementation.

### Final checkpoint (2026-09-02T17:28:13.5463648+09:00)

- Reduced `agent/commands/job-registration.ts` from 651 lines to a 25-line
  public facade.
- Moved contracts, HTTP/Slack target selection, workflow compilation,
  presentations, and propose/commit orchestration into five focused modules
  under `agent/commands/job-registration`.
- Job registration, chat, and command service tests pass 58/58; full Core
  passes 707 with 3 skipped, evaluation passes 11/11, document-engine passes
  37/37, desktop typecheck/build pass, and whitespace checks pass.

## Current task: repository module structure refactor — phase 9

Separate workflow command gateway contracts, validation/read operations,
workflow step normalization, mutations, and one-shot enqueue handling from the
public `agent/commands/workflow-gateway.ts` seam. Preserve all workflow CRUD,
validation, run, target-selection, and enqueue behavior.

### Success criteria

- Existing `AxWorkflowCommandResult`, `AxEnqueueOnceOptions`,
  `AxWorkflowCommandGateway`, and `createWorkflowCommandGateway` exports keep
  their current behavior and import paths.
- Gateway contracts, validation/read helpers, target selection, step
  normalization, mutations, and one-shot enqueue orchestration live in focused
  internal modules with one-way dependencies.
- `agent/commands/workflow-gateway.ts` is <=140 lines and each production
  module under `agent/commands/workflow-gateway` is <=350 lines.
- Workflow command, chat, job registration, runtime, full Core/evaluation,
  document-engine, desktop typecheck/build, and whitespace checks remain green.
- No workflow schema, CRUD semantics, version conflict behavior, target
  precedence, approval policy, connector behavior, UI, credential, or
  external-delivery behavior changes.

### Non-goals for this slice

- No changes to validation issue codes/messages, workflow step normalization,
  operation ordering, version checks, target selection, or queue behavior.
- No new public workflow gateway abstraction beyond the existing facade.
- No refactor of remaining large modules until this slice is independently
  verified.

### Baseline (2026-09-02T17:30:40.3937689+09:00)

- `packages/core/src/agent/commands/workflow-gateway.ts` is 493 lines and
  combines gateway composition, validation/read paths, CRUD mutations, step
  normalization, and one-shot target/enqueue handling.
- Workflow gateway, chat, job-registration, and command-service tests pass
  58/58; Core type checking passes.
- The structural shape check fails as expected because the public module is
  still the combined implementation.

### Final checkpoint (2026-09-02T17:35:59.0802347+09:00)

- Reduced `agent/commands/workflow-gateway.ts` from 493 lines to a 45-line
  public facade.
- Moved gateway contracts, reads/validation, target discovery, step
  normalization, CRUD mutations, and one-shot enqueue handling into focused
  modules under `agent/commands/workflow-gateway`.
- Workflow gateway, chat, job-registration, and command-service tests pass
  58/58; full Core passes 707 with 3 skipped, evaluation passes 11/11,
  document-engine passes 37/37, desktop typecheck/build pass, and whitespace
  checks pass.

## Current task: repository module structure refactor — phase 10

Separate the runtime execution runner's normal execution, sequence traversal,
approval resume, connector context, progress, preflight, and repair helpers
behind the existing `runtime/execution/runner.ts` seam. Preserve execution
status transitions, logs, output-contract gates, approval checkpoints, and
resume behavior.

### Success criteria

- Existing `WorkflowExecutionRunner` and `WorkflowExecutionHost` imports and
  methods keep their current behavior and error modes.
- Normal execution, sequence/branch traversal, approval resume, context
  creation, progress/reporting, preflight, and repair persistence live in
  focused internal modules with one-way dependencies.
- `runtime/execution/runner.ts` is <=160 lines and each production module under
  `runtime/execution` is <=350 lines.
- Runtime engine/manual-run/output-contract behavior, full Core/evaluation,
  document-engine, desktop typecheck/build, and whitespace checks remain green.
- No execution semantics, persistence format, approval policy, connector
  behavior, workflow schema, UI, or external-delivery behavior changes.

### Non-goals for this slice

- No changes to execution ordering, branch continuation, checkpoint shape,
  log contents, error codes, output-contract gates, or approval transitions.
- No new public runtime abstraction beyond the existing runner facade.
- No refactor of remaining large modules until this slice is independently
  verified.

### Baseline (2026-09-02T17:38:57.1808800+09:00)

- `packages/core/src/runtime/execution/runner.ts` is 607 lines and combines
  normal execution, sequence traversal, approval resume, context setup,
  progress, preflight, and repair persistence.
- Runtime engine, manual-run input, and manual-run tests pass 44/44; Core type
  checking passes.
- The structural shape check fails as expected because the runner remains the
  combined implementation.

### Final checkpoint (2026-09-02T17:43:58.6388603+09:00)

- Reduced `runtime/execution/runner.ts` from 607 lines to a 24-line public
  facade.
- Moved normal execution, sequence/branch traversal, approval resume,
  connector context, progress/repair recording, and preflight handling into
  focused execution modules.
- Runtime engine/manual-run tests pass 44/44; full Core passes 707 with 3
  skipped, evaluation passes 11/11, document-engine passes 37/37, desktop
  typecheck/build pass, and whitespace checks pass.

## Current task: repository module structure refactor — phase 11

Separate trigger-engine cursor/event helpers, push transport lifecycle, push
event dispatch, and polling from the public `runtime/trigger-engine.ts` seam.
Preserve timer lifecycle, generation guards, trigger receipts, cursor
advancement, push transport state, and runtime execution behavior.

### Success criteria

- Existing `TriggerEngine` methods and backward-compatible Slack refresh APIs
  keep their current behavior and error handling.
- Cursor parsing/input mapping, push transport lifecycle, push dispatch, and
  poll execution live in focused internal modules with one-way dependencies.
- `runtime/trigger-engine.ts` is <=180 lines and each production module under
  `runtime/trigger-engine` is <=350 lines.
- Trigger lifecycle, runtime, webhook/listener, Slack/Gmail/local-folder
  polling, full Core/evaluation, document-engine, desktop typecheck/build, and
  whitespace checks remain green.
- No trigger filtering, dedupe, cursor, receipt, scheduling, connector,
  workflow, UI, or external-delivery behavior changes.

### Non-goals for this slice

- No changes to polling order, receipt claim/complete/fail semantics, cursor
  persistence, push transport generation, timer intervals, or trigger inputs.
- No new public trigger-engine abstraction beyond the existing facade.
- No refactor of remaining large modules until this slice is independently
  verified.

### Baseline (2026-09-02T17:46:50.0104484+09:00)

- `packages/core/src/runtime/trigger-engine.ts` is 430 lines and combines
  cursor parsing, push lifecycle, push dispatch, polling, and timer state.
- Trigger lifecycle/runtime and connector trigger tests pass 50/50; Core type
  checking passes.
- The structural shape check fails as expected because the public module is
  still the combined implementation.

### Final checkpoint (2026-09-02T17:50:59.7729027+09:00)

- Reduced `runtime/trigger-engine.ts` from 430 lines to a 99-line public
  facade.
- Moved cursor/event helpers, push transport lifecycle, push event dispatch,
  and polling into focused modules under `runtime/trigger-engine`.
- Trigger lifecycle/runtime and connector trigger tests pass 50/50; full Core
  passes 707 with 3 skipped, evaluation passes 11/11, document-engine passes
  37/37, desktop typecheck/build pass, and whitespace checks pass.

## Current task: repository module structure refactor — phase 12

Separate workflow repair contracts, candidate suggestion, workflow rewrite,
and protected-fingerprint helpers from the public `workflow/repair.ts` seam.
Preserve candidate scoring, type compatibility, safe rename behavior, repair
dedupe, replay summaries, and policy protection.

### Success criteria

- Existing repair schemas, types, and functions keep their current behavior
  and import paths.
- Repair contracts, candidate suggestion, expression/document rewriting, and
  protection/dedupe helpers live in focused internal modules with one-way
  dependencies.
- `workflow/repair.ts` is <=140 lines and each production module under
  `workflow/repair` is <=300 lines.
- Repair, Work Discovery repair, repository persistence, runtime, full
  Core/evaluation, document-engine, desktop typecheck/build, and whitespace
  checks remain green.
- No candidate threshold, type compatibility, rewrite scope, policy field,
  persistence, connector, workflow, UI, or external-delivery behavior changes.

### Non-goals for this slice

- No changes to repair candidate scoring/order, schema limits, rewrite rules,
  protected fingerprint, dedupe key, or replay summary values.
- No new public repair abstraction beyond the existing facade.
- No refactor of remaining large modules until this slice is independently
  verified.

### Baseline (2026-09-02T17:53:31.7895909+09:00)

- `packages/core/src/workflow/repair.ts` is 426 lines and combines schemas,
  candidate suggestion, expression/document rewrites, and protection/dedupe.
- Repair, Work Discovery repair, and repository persistence tests pass 7/7;
  Core type checking passes.
- The structural shape check fails as expected because the public module is
  still the combined implementation.

### Final (2026-09-02T18:00:57.7465606+09:00)

- Kept the existing `workflow/repair.ts` interface as a 19-line facade and
  moved contracts, candidate suggestion, expression/document rewriting, and
  protection/dedupe helpers into focused modules under `workflow/repair`.
- Repair, Work Discovery repair, and repository persistence tests pass 7/7;
  full Core passes 707 with 3 skipped, evaluation passes 11/11,
  document-engine passes 37/37, desktop typecheck/build pass, and whitespace
  checks pass.
- No repair thresholds, rewrite rules, policy fields, persistence behavior,
  or public import paths changed.

## Current task: repository module structure refactor — phase 13

Separate database contracts, schema migrations, sql.js implementation, and
backend selection behind the existing 'store/db.ts' seam. Preserve native and
sql.js fallback behavior, persistence timing, migration compatibility, and
readonly database behavior.

### Success criteria

- Existing database types and functions keep their current behavior and import
  paths.
- Database contracts, migration application, sql.js persistence, and backend
  selection live in focused internal modules with one-way dependencies.
- 'store/db.ts' is <=100 lines and each production module under 'store/db' is
  <=300 lines.
- Database migration, repository, runtime, full Core/evaluation,
  document-engine, desktop typecheck/build, and whitespace checks remain green.
- No database schema, migration, backend selection, persistence timing,
  connector, workflow, UI, or external-delivery behavior changes.

### Non-goals for this slice

- No changes to migration SQL, legacy column handling, indexes, fallback
  policy, persistence debounce, or readonly query behavior.
- No new public database abstraction beyond the existing facade.
- No refactor of remaining large modules until this slice is independently
  verified.

## Current task: repository module structure refactor — phase 14

Separate command definitions, generic command helpers, HTTP error metadata,
quality-log interpretation, and capability presentation behind the existing
agent command contract seam. Preserve command names, lifecycle metadata,
validation messages, response shapes, and safe redaction behavior.

### Success criteria

- Existing command contract exports keep their current behavior and import
  paths.
- Definitions, generic command values, HTTP safety helpers, quality parsing,
  and capability summaries live in focused internal modules with one-way
  dependencies.
- 'agent/commands/contract.ts' is <=100 lines and each production module under
  'agent/commands/contract' is <=300 lines.
- Command, chat, job-registration, transport, full Core/evaluation,
  document-engine, desktop typecheck/build, and whitespace checks remain green.
- No command routing, payload, response, connector, workflow, UI, or
  external-delivery behavior changes.

### Non-goals for this slice

- No changes to command definitions, lifecycle or mutability metadata, issue
  and result shapes, redaction limits, quality issue codes, or capability
  summary values.
- No new public command abstraction beyond the existing facade.
- No refactor of remaining large modules until this slice is independently
  verified.

## Current task: repository module structure refactor — phase 15

Separate condition schemas, legacy migration, input coercion, normalization,
evaluation, and display formatting behind the existing
runtime/condition-expr.ts seam. Preserve all accepted legacy/LLM shapes,
comparison semantics, invalid-input handling, and output formatting.

### Success criteria

- Existing condition types, schemas, and functions keep their current behavior
  and import paths.
- Schema, migration, coercion, normalization, evaluation, and formatting live
  in focused internal modules with one-way dependencies.
- runtime/condition-expr.ts is <=100 lines and each production module under
  runtime/condition-expr is <=300 lines.
- Condition, workflow-schema, draft-condition, presentation, full
  Core/evaluation, document-engine, desktop typecheck/build, and whitespace
  checks remain green.
- No workflow, trigger, transform, command, UI, or external-delivery behavior
  changes.

### Non-goals for this slice

- No changes to accepted condition shapes, comparison coercion, legacy
  migration, invalid-input fallback, evaluation semantics, or display text.
- No new public condition abstraction beyond the existing facade.
- No refactor of remaining large modules until this slice is independently
  verified.

## Current task: repository module structure refactor — phase 16

Separate workflow contract-structure validation into trigger configuration,
action configuration, reference/output helpers, and control-flow validation
behind the existing contract-validation/structure.ts seam. Preserve issue
codes, messages, ordering, cycle handling, and public import paths.

### Success criteria

- Existing structure-validation functions keep their current behavior and
  import paths.
- Trigger, action, reference/output, and control-flow validation live in
  focused internal modules with one-way dependencies.
- contract-validation/structure.ts is <=100 lines and each production module
  under contract-validation/structure is <=300 lines.
- Contract-validator, contract-adapter, workflow-schema, full Core/evaluation,
  document-engine, desktop typecheck/build, and whitespace checks remain green.
- No workflow semantics, connector availability, persistence, UI, or
  external-delivery behavior changes.

### Non-goals for this slice

- No changes to validation issue codes, messages, ordering, trigger checks,
  action parameter handling, reference rules, cycle detection, or notification
  branch rules.
- No new public validation abstraction beyond the existing facade.
- No refactor of remaining large modules until this slice is independently
  verified.

## Current task: repository module structure refactor — phase 17

Separate workspace-source contracts, session/error validation, document
summary/public projection, and bounded document handling behind the existing
workspace-source-service.ts seam. Preserve source lifecycle, queue behavior,
artifact cleanup, manifest contents, bounded reads, and public import paths.

### Success criteria

- Existing workspace-source types, error class, and service methods keep their
  current behavior and import paths.
- Contracts, validation, document projection, and bounded handling live in
  focused internal modules with one-way dependencies.
- workspace-source-service.ts is <=300 lines and each production module under
  store/workspace-source is <=300 lines.
- Workspace-source, document-engine, repository, full Core/evaluation,
  desktop typecheck/build, and whitespace checks remain green.
- No source status, artifact, document-engine, persistence, UI, or
  external-delivery behavior changes.

### Non-goals for this slice

- No changes to source status transitions, error codes/messages, character
  budgets, public document fields, manifest format, artifact GC, or queue
  scheduling.
- No new public workspace-source abstraction beyond the existing service.
- No refactor of remaining large modules until this slice is independently
  verified.

### Final (2026-09-02T18:33:22.8739736+09:00)

- Kept the existing workspace-source-service.ts interface and reduced the
  service implementation to 251 lines. Moved contracts, validation/error
  handling, document projection/bounding, and manifest helpers into focused
  modules under store/workspace-source.
- Workspace-source, repository, and document-engine tests pass 17/17; full
  Core passes 707 with 3 skipped, evaluation passes 11/11, document-engine
  passes 37/37, desktop typecheck/build pass, and whitespace checks pass.
- No source lifecycle, error codes, document fields, character budgets,
  manifest format, artifact GC, queue behavior, or public import paths changed.

### Baseline (2026-09-02T18:29:40.7606595+09:00)

- store/workspace-source-service.ts is 372 lines and combines contracts,
  validation, document projection/bounding, ingestion lifecycle, manifest
  writing, and artifact GC.
- Workspace-source, repository, and document-engine tests pass 17/17; Core
  type checking passes.
- The structural shape check fails as expected because the public service is
  still the combined implementation.

### Final (2026-09-02T18:27:55.1953934+09:00)

- Kept contract-validation/structure.ts as a 2-line public facade and moved
  trigger, action, reference/output, and control-flow validation into focused
  modules.
- Contract validation, adapter validation, workflow schema, and presentation
  tests pass 26/26; full Core passes 707 with 3 skipped, evaluation passes
  11/11, document-engine passes 37/37, desktop typecheck/build pass, and
  whitespace checks pass.
- No validation issue codes, messages, ordering, cycle behavior, branch rules,
  or public import paths changed.

### Baseline (2026-09-02T18:23:42.2099278+09:00)

- contract-validation/structure.ts is 378 lines and combines trigger,
  action, reference/output, cycle, notification branch, and control-flow
  checks.
- Contract validation, adapter validation, workflow schema, and presentation
  tests pass 26/26; Core type checking passes.
- The structural shape check fails as expected because the public module is
  still the combined implementation.

### Final (2026-09-02T18:21:54.9423619+09:00)

- Kept the existing runtime/condition-expr.ts interface as a 20-line facade
  and moved condition schema, legacy migration, input coercion, normalization,
  evaluation, and formatting into focused modules.
- Condition, workflow-schema, draft condition, and presentation tests pass
  21/21; full Core passes 707 with 3 skipped, evaluation passes 11/11,
  document-engine passes 37/37, desktop typecheck/build pass, and whitespace
  checks pass.
- No accepted condition shapes, comparison semantics, migration behavior,
  invalid-input handling, display text, or public import paths changed.

### Baseline (2026-09-02T18:18:21.7654696+09:00)

- runtime/condition-expr.ts is 379 lines and combines schemas, legacy
  conversion, input coercion, normalization, evaluation, and formatting.
- Condition evaluation, workflow schema, draft condition, and presentation
  tests pass 21/21; Core type checking passes.
- The structural shape check fails as expected because the public module is
  still the combined implementation.

### Baseline (2026-09-02T18:12:48.7023228+09:00)

- 'packages/core/src/agent/commands/contract.ts' is 431 lines and combines
  command definitions, generic helpers, HTTP safety, quality parsing, and
  capability presentation.
- Command, chat, job-registration, schema, and transport tests pass 68/68;
  Core type checking passes.
- The structural shape check fails as expected because the public module is
  still the combined implementation.

### Baseline (2026-09-02T18:04:23.9880669+09:00)

- 'packages/core/src/store/db.ts' is 414 lines and combines migration SQL,
  sql.js persistence, native fallback selection, and readonly opening.
- Database migration and workflow repository tests pass 10/10; Core type
  checking passes.
- The structural shape check fails as expected because the public module is
  still the combined implementation.

### Current structural task: output contract boundaries (phase 18)

Split the runtime output-contract implementation behind its existing public
module so input-column description/compatibility, input-schema validation,
output validation, and failure helpers have focused ownership. Preserve all
runtime behavior, issue codes/messages/order, privacy-safe payloads, and
existing import paths.

### Success criteria

- runtime/output-contract.ts remains the stable public facade and is <= 80 lines.
- Focused output-contract modules each remain <= 300 lines and have one clear
  responsibility.
- Existing output-contract, workflow-repair, execution, and runtime behavior
  tests remain green.
- Full Core, evaluation, document-engine, desktop typecheck/build, and
  whitespace checks remain green.

### Non-goals

- Changing output-contract schemas, issue semantics, privacy policy, baseline
  thresholds, execution behavior, or public exports.
- Refactoring other runtime modules until this slice is verified.

### Baseline (2026-09-02T18:38:46.4488521+09:00)

- runtime/output-contract.ts is 317 lines and combines input inspection,
  input-schema validation, output validation, and failure helpers.
- Output-contract, execution, and workflow-repair regression tests pass 14/14;
  Core type checking passes.
- The structural shape check fails as expected because the public module is
  still the combined implementation.

### Final (2026-09-02T18:44:55.0126929+09:00)

- Kept runtime/output-contract.ts as a 4-line public facade and moved types,
  input inspection/schema validation, output validation, and failure helpers
  into focused modules under runtime/output-contract.
- Output-contract, execution, and workflow-repair regression tests pass 14/14;
  full Core passes 707 with 3 skipped, evaluation passes 11/11,
  document-engine passes 37/37, desktop typecheck/build pass, and whitespace
  checks pass.
- No output-contract schemas, issue codes/messages/order, privacy-safe payloads,
  baseline thresholds, execution behavior, or public import paths changed.

### Current structural task: workflow canvas compiler boundaries (phase 19)

Split the workflow canvas compiler behind its existing builder module so draft
step/trigger conversion and final/lenient IR assembly have focused ownership.
Preserve graph validation, capability resolution, injected trigger steps,
approval consolidation, contract compilation, rendered documents, errors, and
all existing import paths.

### Success criteria

- workflow/canvas/compile/builder.ts remains the stable public facade and is
  <= 80 lines.
- Focused builder modules each remain <= 300 lines and have one clear
  responsibility.
- Existing canvas compilation, persisted-document, workflow schema, and
  presentation behavior tests remain green.
- Full Core, evaluation, document-engine, desktop typecheck/build, and
  whitespace checks remain green.

### Non-goals

- Changing draft schemas, graph issue ordering, capability mapping, trigger
  inputs, approval behavior, IR shape, rendering, or error semantics.
- Refactoring other workflow modules until this slice is verified.

### Baseline (2026-09-02T18:47:12.8589926+09:00)

- workflow/canvas/compile/builder.ts is 354 lines and combines node
  conversion, trigger construction, lenient compilation, and final IR
  assembly.
- Canvas, persisted-document, schema, and presentation regression tests pass
  30/30; Core type checking passes.
- The structural shape check fails as expected because the public builder is
  still the combined implementation.

### Final (2026-09-02T18:52:35.3020453+09:00)

- Kept builder.ts as a 3-line public facade and moved capability/error
  handling, node/trigger conversion, lenient step conversion, and final/partial
  IR assembly into focused builder modules.
- Canvas, persisted-document, schema, and presentation regression tests pass
  30/30; full Core passes 707 with 3 skipped, evaluation passes 11/11,
  document-engine passes 37/37, desktop typecheck/build pass, and whitespace
  checks pass.
- No draft schemas, graph issue ordering, capability mapping, trigger inputs,
  approval behavior, IR shape, rendering, error semantics, or public import
  paths changed.

### Current structural task: workspace chat repository boundaries (phase 20)

Split the workspace-chat repository behind its existing public module so chat
contracts/JSON parsing, title and memo metadata, queries, and mutations have
focused ownership. Preserve transcript validation, corrupt-row handling,
execution-result idempotency, source-derived titles, workflow mapping,
source counts, timestamps, and all existing import paths.

### Success criteria

- workspace-chat-repository.ts remains the stable public facade and is <= 80
  lines.
- Focused workspace-chat modules each remain <= 300 lines and have one clear
  responsibility.
- Existing workspace-chat, bootstrap, command, source, and execution-result
  behavior tests remain green.
- Full Core, evaluation, document-engine, desktop typecheck/build, and
  whitespace checks remain green.

### Non-goals

- Changing chat schemas, validation errors, title rules, memo merge behavior,
  SQL, ordering, idempotency, source counts, timestamps, persistence, or
  public exports.
- Refactoring other store modules until this slice is verified.

### Baseline (2026-09-02T18:55:35.5144622+09:00)

- workspace-chat-repository.ts is 351 lines and combines contracts/JSON
  parsing, metadata, queries, persistence, execution-result merging, and
  deletion.
- Workspace-chat, bootstrap, command, source, and execution-result regression
  tests pass 42/42; Core type checking passes.
- The structural shape check fails as expected because the public repository
  is still the combined implementation.

### Final (2026-09-02T18:58:36.9758232+09:00)

- Kept workspace-chat-repository.ts as a 19-line public facade and moved chat
  contracts/JSON parsing, title, memo, queries, and mutations into focused
  modules.
- Workspace-chat, bootstrap, command, source, and execution-result regression
  tests pass 42/42; full Core passes 707 with 3 skipped, evaluation passes
  11/11, document-engine passes 37/37, desktop typecheck/build pass, and
  whitespace checks pass.
- No chat schemas, validation errors, title rules, memo behavior, SQL,
  ordering, idempotency, source counts, timestamps, persistence, or public
  exports changed.

### Current structural task: discovery workflow compiler boundaries (phase 21)

Split the Work Discovery compile-workflow implementation behind its existing
public module so source/transform dependency collection, input-contract
construction, source-step creation, and final WorkflowIR assembly have focused
ownership. Preserve generated ids, source fallback behavior, transform
bindings, input schemas, permissions, trigger selection, output contracts,
rendered document JSON, and all existing import paths.

### Success criteria

- work-discovery/compile/compile-workflow.ts remains the stable public facade
  and is <= 80 lines.
- Focused compile-workflow modules each remain <= 300 lines and have one clear
  responsibility.
- Existing discovery compilation, Work Discovery, RDB E2E, schema, and
  presentation behavior tests remain green.
- Full Core, evaluation, document-engine, desktop typecheck/build, and
  whitespace checks remain green.

### Non-goals

- Changing blueprint schemas, generated step ids, source fallback rules,
  transform semantics, bindings, input contracts, permissions, triggers,
  document JSON, or public exports.
- Refactoring other discovery modules until this slice is verified.

### Baseline (2026-09-02T19:01:17.1736071+09:00)

- compile-workflow.ts is 318 lines and combines source/transform dependency
  collection, input-contract construction, source-step creation, and final
  WorkflowIR assembly.
- Discovery compilation, Work Discovery, RDB E2E, schema, and presentation
  regression tests pass 34/34; Core type checking passes.
- The structural shape check fails as expected because the public compiler is
  still the combined implementation.

### Final (2026-09-02T19:04:07.4096654+09:00)

- Kept compile-workflow.ts as a 1-line public facade and moved source
  dependency helpers, source-step creation, input-contract construction, and
  WorkflowIR assembly into focused modules.
- Discovery compilation, Work Discovery, RDB E2E, schema, and presentation
  regression tests pass 34/34; full Core passes 707 with 3 skipped, evaluation
  passes 11/11, document-engine passes 37/37, desktop typecheck/build pass,
  and whitespace checks pass.
- No blueprint schemas, generated step ids, source fallback rules, transform
  semantics, bindings, input contracts, permissions, triggers, document JSON,
  or public exports changed.

### Current structural task: document engine client boundaries (phase 22)

Split the document-engine client behind its existing public module so client
contracts, worker/python path resolution, stdio transport, mock behavior, and
configured-client registration have focused ownership. Preserve the PDF,
Docling, worker, timeout, error, mock, and singleton behavior already in the
current implementation.

### Success criteria

- document-engine/engine-client.ts remains the stable public facade and is
  <= 80 lines.
- Focused engine-client modules each remain <= 300 lines and have one clear
  responsibility.
- Existing document-engine client, document read/write, PDF, design-tool, and
  integration behavior tests remain green.
- Full Core, evaluation, document-engine, desktop typecheck/build, and
  whitespace checks remain green.

### Non-goals

- Changing document-engine request/response shapes, worker command names,
  paths, environment variables, timeouts, error messages, mock data, or
  configured-client behavior.
- Refactoring the Python worker or PDF implementation until this slice is
  verified.

### Baseline (2026-09-02T19:06:33.0019246+09:00)

- engine-client.ts is 352 lines and combines client contracts, path
  resolution, stdio transport, mock behavior, and configured-client
  registration.
- Document-engine client, document read/write, PDF, design-tool, and
  integration regression tests pass 32/32; Core type checking passes.
- The structural shape check fails as expected because the public client is
  still the combined implementation.

### Final (2026-09-02T19:11:38.3305896+09:00)

- Kept engine-client.ts as a 15-line public facade and moved contracts, worker
  path resolution, stdio transport, mock behavior, and client registration
  into focused modules.
- Document-engine client, document read/write, PDF, design-tool, and
  integration regression tests pass 32/32; full Core passes 707 with 3
  skipped, evaluation passes 11/11, document-engine passes 37/37, desktop
  typecheck/build pass, and whitespace checks pass.
- No document-engine request/response shapes, worker commands, paths,
  environment variables, timeouts, errors, mock data, singleton behavior, or
  public exports changed.

### Current structural task: agent command schema boundaries (phase 23)

Split the command schema implementation behind its existing public module so
command names and parsing, bounded user input/UI presentation, result/status
contracts, and workflow/execution/repair argument contracts have focused
ownership. Preserve every existing command schema, default, issue shape,
validation rule, alias, parser, and public export.

### Success criteria

- agent/commands/schema.ts remains the stable public facade and is <= 80 lines.
- Focused schema modules each remain <= 300 lines and have one clear
  responsibility.
- Existing command schema, input request, transport, gateway, workflow, and
  job-registration behavior remains green.
- Full Core, evaluation, document-engine, desktop typecheck/build, and
  whitespace checks remain green.

### Non-goals

- Changing command names, argument shapes, defaults, validation limits,
  issue/status values, UI presentation semantics, workflow semantics, or
  capability policy.
- Refactoring command handlers or adding new command types until this slice is
  verified.

### Baseline (2026-09-02T19:17:26.7919273+09:00)

- schema.ts is 321 lines and combines command, interaction, result, and
  workflow/execution/repair contracts.
- Existing command schema and gateway regression tests pass 55/55; Core type
  checking passes.
- The structural shape check fails as expected because the public schema is
  still the combined implementation.

### Final (2026-09-02T19:22:51.3613755+09:00)

- Kept schema.ts as a 59-line public facade and moved command parsing and
  lifecycle metadata, bounded input/UI interaction, result/status contracts,
  and source/workflow/execution/repair argument schemas into focused modules.
- Command schema and gateway regression tests pass 55/55; full Core passes 707
  with 3 skipped, evaluation passes 11/11, document-engine passes 37/37,
  desktop typecheck/build pass, and whitespace checks pass.
- Confirmed all original schema declaration names remain present and focused
  modules do not import the public schema facade.
- No command names, argument shapes, defaults, validation limits, issue/status
  values, UI semantics, workflow semantics, capability policy, or public
  exports changed.

### Current structural task: PDF to HTML conversion boundaries (phase 24)

Split the document-engine PDF-to-HTML implementation behind its existing
`write.pdf_to_html` module so result/cache contracts, HTML round-trip page
assembly, engine selection/conversion, and artifact persistence have focused
ownership. Preserve the generated HTML, metadata, cache behavior, fallback
rules, errors, and private helpers used by the existing tests.

### Success criteria

- write/pdf_to_html.py remains the stable public module and is <= 80 lines.
- Focused PDF-to-HTML modules each remain <= 300 lines and have one clear
  responsibility.
- Existing PDF-to-HTML tests and worker-facing imports remain green.
- Full Core, evaluation, document-engine, desktop typecheck/build, and
  whitespace checks remain green.

### Non-goals

- Changing Docling options, HTML structure/CSS, page sizing, embedded images,
  cache keys/metadata, fallback behavior, file paths, error messages, or
  worker request/response shapes.
- Refactoring PDF form analysis/fill or the Python worker until this slice is
  verified.

### Baseline (2026-09-02T19:26:22.9314931+09:00)

- write/pdf_to_html.py is 373 lines and combines conversion contracts, cache
  validation, HTML assembly, engine selection, and artifact persistence.
- Existing PDF-to-HTML regression tests pass 4/4 after correcting the evaluator
  to use unittest discovery from the document-engine source root.
- The structural shape check fails as expected because the public converter is
  still the combined implementation.

### Final (2026-09-02T19:32:49.9656946+09:00)

- Kept write/pdf_to_html.py as a 32-line public facade and moved result/style
  contracts, cache validation, round-trip page assembly, engine selection, and
  artifact persistence into focused modules.
- PDF-to-HTML regression tests pass 4/4; full Core passes 707 with 3 skipped,
  evaluation passes 11/11, document-engine passes 37/37, desktop
  typecheck/build pass, and whitespace checks pass.
- Existing result fields, private helper imports, generated HTML/CSS, Docling
  options, cache metadata, fallback rules, errors, and worker-facing behavior
  were preserved.

### Current structural task: document worker command boundaries (phase 25)

Split the document-engine worker behind its existing script/module seam so
ingest, PDF operations, artifact queries, shared response projection, command
dispatch, and stdio handling have focused ownership. Preserve raw worker
stdin/stdout behavior, request/response shapes, validation order, fallback
rules, error strings, exit codes, and existing test imports.

### Success criteria

- worker.py remains the stable executable/module facade and is <= 80 lines.
- Focused worker modules each remain <= 300 lines and have one clear
  responsibility.
- Existing worker contract, ingest, PDF form, PDF-to-HTML, and adapter tests
  remain green.
- Full Core, evaluation, document-engine, desktop typecheck/build, and
  whitespace checks remain green.

### Non-goals

- Changing worker commands, request/response JSON, validation order, error
  messages, artifact layout, adapter selection, fallback behavior, PDF output,
  or stdio encoding/exit-code semantics.
- Refactoring adapters or document/PDF implementations until this slice is
  verified.

### Baseline (2026-09-02T19:35:12.4051987+09:00)

- worker.py is 314 lines and combines command dispatch, ingest, PDF operations,
  manifest queries, response projection, and stdio protocol handling.
- Existing worker contract tests pass 5/5, PDF form tests pass 18/18, and
  PDF-to-HTML tests pass 4/4.
- The structural shape check fails as expected because the executable worker is
  still the combined implementation.

### Final (2026-09-02T19:38:27.0229997+09:00)

- Kept worker.py as a 42-line executable/module facade and moved shared
  response projection, ingest, PDF commands, artifact queries, dispatch, and
  stdio handling into focused modules.
- Worker contract tests pass 5/5, PDF form tests pass 18/18, PDF-to-HTML tests
  pass 4/4; full Core passes 707 with 3 skipped, evaluation passes 11/11,
  document-engine passes 37/37, desktop typecheck/build pass, and whitespace
  checks pass.
- Raw stdin/stdout execution, request validation order, response shapes,
  fallback rules, error strings, artifact paths, and exit-code behavior were
  preserved.

### Current structural task: command service boundaries (phase 26)

Split the AI-facing command service behind its existing AxCommandService class
seam so dependency/state construction, command dispatch, read/session source
handling, resource/capability listing, context updates, and execution
explanation have focused ownership. Preserve the public class, constructor
options, command access policy, result tuples, callbacks, state lifetime, and
all command behavior.

### Success criteria

- agent/commands/service.ts remains the stable public facade and is <= 220
  lines.
- Focused command-service modules each remain <= 300 lines and have one clear
  responsibility.
- Existing command service, job registration, chat, and command transport
  behavior remains green.
- Full Core, evaluation, document-engine, desktop typecheck/build, and
  whitespace checks remain green.

### Non-goals

- Changing command routing, access policy, schemas, result/status values,
  callback behavior, gateway construction, state lifetime, persistence,
  connector behavior, or public exports.
- Refactoring the existing command gateways or adding new commands until this
  slice is verified.

### Baseline (2026-09-02T19:41:56.7022528+09:00)

- agent/commands/service.ts is 542 lines and combines service construction,
  command dispatch, read tools, session sources, resources, context updates,
  execution explanation, and job handling.
- Existing command service, job-registration, chat, and transport tests pass
  66/66; Core type checking passes.
- The structural shape check fails as expected because the public service is
  still the combined implementation.

### Final (2026-09-02T19:55:57.9329042+09:00)

- Kept agent/commands/service.ts as the stable 83-line public facade and moved
  state construction, command dispatch, command catalog, reads, resources,
  context updates, execution explanation, and Slack callback wiring into
  focused internal modules.
- Focused modules are 16-198 lines and do not import the public facade.
  Constructor options, command parsing, access checks, result tuples,
  callbacks, pending job lifetime, gateway construction, and public exports
  remain unchanged.
- Command service, job-registration, chat, and transport tests pass 66/66;
  full Core passes 707 with 3 skipped, evaluation passes 11/11,
  document-engine passes 37/37, desktop typecheck/build pass, and whitespace
  checks pass.

### Current structural task: desktop connection IPC boundaries (phase 27)

Split the desktop connection IPC registration behind the existing
registerConnectionHandlers function so each connector family has focused
ownership. Preserve IPC channel names and registration order, payload
validation, error/result behavior, core/runtime/store mutations, and state
notifications.

### Success criteria

- electron/main/ipc/connection-handlers.ts remains the stable registration
  facade and is <= 120 lines.
- Focused connection-handler modules each remain <= 220 lines and have one
  connector-family responsibility.
- Desktop typecheck and production build remain green.
- Full Core, evaluation, document-engine, desktop, and whitespace checks
  remain green.

### Non-goals

- Changing IPC channel names, registration order, payload validation,
  error/result strings, connection behavior, runtime/store mutations,
  notifications, preload contracts, or security policy.
- Refactoring unrelated IPC handlers, connector implementations, UI, or
  adding new connection features until this slice is verified.

### Baseline (2026-09-02T19:58:53.4348577+09:00)

- The 376-line connection-handlers.ts file combines eight connector families,
  native dialogs, payload validation, persistence, runtime setup, and state
  notification.
- The structural shape check fails as expected because the public registration
  module is still combined; desktop typecheck and production build pass.

### Final (2026-09-02T20:05:11.0684101+09:00)

- Kept electron/main/ipc/connection-handlers.ts as the stable 19-line
  registration facade and moved Slack, Gmail, local-folder, HTTP, Webhook,
  RDB, OpenAPI, and MCP handlers into focused connector-family modules.
- Preserved all 18 IPC channels, their original registration order, payload
  validation, result/error behavior, connection side effects, and state
  notifications. Focused modules are 14-122 lines.
- Channel order comparison passes 18/18; full Core passes 707 with 3 skipped,
  evaluation passes 11/11, document-engine passes 37/37, desktop typecheck
  and build pass, and whitespace checks pass.

### Current structural task: scheduled job registration boundaries (phase 28)

Split the job-registration service behind its existing service.ts module so
proposal validation/preview and confirmed commit/persistence have focused
ownership. Preserve the public re-exports, schemas, input requests,
confirmation flow, pending draft lifetime, workflow persistence, and optional
run-once callback behavior.

### Success criteria

- agent/commands/job-registration/service.ts remains the stable service
  facade and is <= 80 lines.
- Proposal, commit, and shared validation modules each remain <= 240 lines
  and have one clear responsibility.
- Existing command/job/chat/transport behavior remains green.
- Full Core, evaluation, document-engine, desktop typecheck/build, and
  whitespace checks remain green.

### Non-goals

- Changing command schemas, result/status values, input requests, confirmation
  actions, draft keys, workflow persistence, scheduling defaults, connector
  checks, run-once behavior, or public exports.
- Refactoring job compile/target/presentation modules or adding features until
  this slice is verified.

### Baseline (2026-09-02T20:07:33.5456657+09:00)

- job-registration/service.ts is 308 lines and combines proposal validation,
  target selection, preview construction, commit persistence, and run-once
  execution.
- The structural shape check fails as expected; Core typecheck and the
  command/job/chat/transport regression pass 66/66.

### Final (2026-09-02T20:10:19.6310500+09:00)

- Kept job-registration/service.ts as the stable 2-line re-export facade and
  separated proposal/preview, commit/persistence, and shared issue/input
  mapping into focused modules.
- Preserved public exports, input validation, target selection, confirmation
  presentation, pending draft keys and lifetime, workflow persistence, and
  run-once callback behavior. Focused modules are 54-189 lines.
- Command/job/chat/transport regression passes 66/66; full Core passes 707
  with 3 skipped, evaluation passes 11/11, document-engine passes 37/37,
  desktop typecheck/build pass, and whitespace checks pass.

### Current structural task: workflow store repository boundaries (phase 29)

Split the WorkflowStore repository facade behind its existing class seam so
workflow, workspace, execution, approval, settings, trigger receipt,
discovery, and repair persistence adapters have focused ownership. Preserve
all public methods, argument/result shapes, repository call order, and
database behavior.

### Success criteria

- store/workflow-store.ts remains the stable public class facade and is <= 220
  lines.
- Focused store modules each remain <= 180 lines and have one persistence
  responsibility.
- Existing store, runtime, workflow, discovery, command, and end-to-end
  behavior remains green.
- Full Core, evaluation, document-engine, desktop typecheck/build, and
  whitespace checks remain green.

### Non-goals

- Changing public WorkflowStore methods, repository SQL, migrations,
  transaction behavior, argument/result shapes, persistence ordering, or
  database selection.
- Refactoring repository implementations, UI, connectors, or adding storage
  features until this slice is verified.

### Baseline (2026-09-02T20:12:49.0701901+09:00)

- store/workflow-store.ts is 316 lines and directly combines eight repository
  domains behind the public store class.
- The structural shape check fails as expected; Core typecheck and the full
  Core regression pass, with 707 tests passed and 3 skipped.

### Evaluator revision (2026-09-02T20:17:19.7760320+09:00)

- The initial 110-line facade threshold was too strict for the existing 61
  public methods and would reward dense one-line formatting over readable
delegation. It is revised to 220 lines while keeping the internal module
limit and all behavior/regression checks unchanged.

### Final (2026-09-02T20:22:11.7391643+09:00)

- store/workflow-store.ts is 197 lines; focused modules are 26-89 lines.
- Core typecheck, full Core regression (707 passed, 3 skipped), evaluation
  (11/11), document-engine regression (37/37), desktop typecheck/build, and
  whitespace checks all pass.
- Focused modules do not import the public facade, and no production behavior
  or public WorkflowStore method changed.

### Current structural task: Slack Socket Mode boundaries (phase 30)

Split the Slack Socket Mode trigger module behind its existing public import
path. Keep Slack SDK error redaction/logging and listener lifecycle/event
translation as focused implementations while preserving all exports, event
payloads, connection state notifications, reconnect behavior, and secret
handling.

### Success criteria

- triggers/slack/new-message/socket-mode.ts remains the stable public facade
  and is <= 80 lines.
- Focused Socket Mode modules each remain <= 180 lines and have one clear
  responsibility.
- Slack Socket Mode and channel matching regressions remain green.
- Full Core, evaluation, document-engine, desktop typecheck/build, and
  whitespace checks remain green.

### Non-goals

- Changing Slack connection behavior, event filtering, payload shapes,
  lifecycle generation rules, error redaction rules, SDK configuration, or
  public exports.
- Refactoring unrelated triggers, connectors, UI, credentials, or tests until
  this slice is verified.

### Baseline (2026-09-02T20:26:15.8135005+09:00)

- socket-mode.ts is 304 lines and combines SDK diagnostics, error redaction,
  listener lifecycle, Slack event filtering, channel lookup, and event
  translation.
- The structural shape check fails as expected because the public module is
  304 lines and the focused directory does not exist yet.
- Core typecheck passes, and the Slack Socket Mode plus channel matching
  regression passes 7/7.

### Final (2026-09-02T20:32:38.3012666+09:00)

- socket-mode.ts is 6 lines; focused modules are contracts 8, diagnostics 145,
  and listener 163 lines.
- Core typecheck, full Core regression (707 passed, 3 skipped), evaluation
  (11/11), document-engine regression (37/37), desktop typecheck/build, and
  whitespace checks all pass.
- The public exports, Slack event payloads, filtering, lifecycle generation,
  reconnect handling, channel label lookup, and secret redaction remain
  unchanged.

### Current structural task: CLI JSON boundaries (phase 31)

Split the agent model JSON module behind its existing public import path.
Separate provider-output parsing and recovery from Zod-to-provider schema
conversion while preserving all exports, parsing diagnostics, nested envelope
handling, control-character recovery, and generated schema shapes.

### Success criteria

- agent/model/cli-json.ts remains the stable public facade and is <= 60 lines.
- Focused CLI JSON modules each remain <= 180 lines and have one clear
  responsibility.
- CLI JSON and model output regressions remain green.
- Full Core, evaluation, document-engine, desktop typecheck/build, and
  whitespace checks remain green.

### Non-goals

- Changing JSON extraction, parse errors, nested output candidates, schema
  conversion, Codex schema sanitization, provider wire formats, or public
  exports.
- Refactoring unrelated model execution, command transports, UI, or tests
  until this slice is verified.

### Baseline (2026-09-02T20:35:36.7294881+09:00)

- cli-json.ts is 303 lines and combines raw JSON extraction, structured output
  validation, control-character recovery, and two schema conversion policies.
- The structural shape check fails as expected because the public module is
  303 lines and the focused directory does not exist yet.
- Core typecheck passes, and the CLI JSON plus model output regression passes
  23/23.

### Final (2026-09-02T20:40:09.7791903+09:00)

- cli-json.ts is 9 lines; focused modules are parser 146 and schema 149 lines.
- Core typecheck, full Core regression (707 passed, 3 skipped), evaluation
  (11/11), document-engine regression (37/37), desktop typecheck/build, and
  whitespace checks all pass.
- Existing JSON extraction, diagnostics, nested envelope handling,
  control-character recovery, provider schema shapes, and public exports remain
  unchanged.

### Current structural task: HTTP connection boundaries (phase 32)

Split the HTTP connection module behind its existing public import path.
Separate connection contracts, endpoint parsing/serialization, secret
handling, and status/endpoint selection while preserving all exported types,
legacy configuration compatibility, authentication behavior, and endpoint
matching rules.

### Success criteria

- modules/http/connection.ts remains the stable public facade and is <= 60
  lines.
- Focused HTTP connection modules each remain <= 180 lines and have one clear
  responsibility.
- HTTP connection, request, and URL-security regressions remain green.
- Full Core, evaluation, document-engine, desktop typecheck/build, and
  whitespace checks remain green.

### Non-goals

- Changing connection schemas, legacy config migration, secret merging,
  endpoint selection, status semantics, URL security, provider behavior, or
  public exports.
- Refactoring unrelated HTTP request code, connectors, UI, credentials, or
  tests until this slice is verified.

### Baseline (2026-09-02T20:42:10.6652117+09:00)

- modules/http/connection.ts is 280 lines and combines contracts, endpoint
  parsing, serialization, secret handling, status calculation, and matching.
- The structural shape check fails as expected because the public module is
  280 lines and the focused directory does not exist yet.
- Core typecheck passes, and the HTTP connection, request, and URL-security
  regressions pass 36/36.

### Final (2026-09-02T20:45:05.9388208+09:00)

- connection.ts is 32 lines; focused modules are contracts 66, parse 98,
  secrets 62, and status 69 lines.
- Core typecheck, full Core regression (707 passed, 3 skipped), evaluation
  (11/11), document-engine regression (37/37), desktop typecheck/build, and
  whitespace checks all pass.
- Legacy single-URL configuration, multi-endpoint parsing, secret merging,
  status calculation, endpoint matching, and public exports remain unchanged.

### Current structural task: CLI process boundaries (phase 33)

Split the CLI process module behind its existing public import path. Separate
command environment and binary/runtime resolution from child-process execution
while preserving command invocation shapes, platform-specific resolution,
stdin delivery, argv/output limits, timeout behavior, abort behavior, and
streaming callbacks.

### Success criteria

- agent/model/cli-process.ts remains the stable public facade and is <= 60
  lines.
- Focused CLI process modules each remain <= 220 lines and have one clear
  responsibility.
- CLI process and model adapter regressions remain green.
- Full Core, evaluation, document-engine, desktop typecheck/build, and
  whitespace checks remain green.

### Non-goals

- Changing binary lookup order, environment variables, command invocation
  shapes, output limits, timeout/abort semantics, provider adapters, or public
  exports.
- Refactoring unrelated model parsing, UI, connectors, or tests until this
  slice is verified.

### Baseline (2026-09-02T20:46:59.2168112+09:00)

- cli-process.ts is 285 lines and combines environment/path discovery,
  platform-specific runtime resolution, non-streaming execution, and streaming
  execution.
- The structural shape check fails as expected because the public module is
  285 lines and the focused directory does not exist yet.
- Core typecheck passes, and the CLI process plus model adapter regression
  passes 29/29.

### Final (2026-09-02T20:49:42.0814468+09:00)

- cli-process.ts is 9 lines; focused modules are contracts 10, environment 113,
  and runner 166 lines.
- Core typecheck, full Core regression (707 passed, 3 skipped), evaluation
  (11/11), document-engine regression (37/37), desktop typecheck/build, and
  whitespace checks all pass.
- Binary lookup, platform-specific runtime resolution, stdin delivery,
  argument/output limits, timeout/abort behavior, streaming callbacks, and
  public exports remain unchanged.

### Current structural task: investigation input boundaries (phase 34)

Split the AI investigation input module behind its existing public import
path. Separate document/email/context prompt assembly from visual artifact
discovery and image loading while preserving input precedence, truncation
limits, sensitive-data policy, image MIME/size limits, and error codes.

### Success criteria

- runtime/investigation/input.ts remains the stable public facade and is <= 60
  lines.
- Focused investigation input modules each remain <= 220 lines and have one
  clear responsibility.
- Investigation, evidence, prompt, and AI model regressions remain green.
- Full Core, evaluation, document-engine, desktop typecheck/build, and
  whitespace checks remain green.

### Non-goals

- Changing input precedence, prompt text, truncation limits, sensitive-data
  handling, visual reference discovery, image loading, provider behavior, or
  public exports.
- Refactoring unrelated investigation output/evidence code, UI, connectors, or
  tests until this slice is verified.

### Baseline (2026-09-02T20:51:31.5363788+09:00)

- runtime/investigation/input.ts is 264 lines and combines text/email context
  selection, prompt assembly, visual reference discovery, and image loading.
- The structural shape check fails as expected because the public module is
  264 lines and the focused directory does not exist yet.
- Core typecheck passes, and the investigation/observation/vision regression
  passes 21/21.

### Final (2026-09-02T20:58:13.8932940+09:00)

- `runtime/investigation/input.ts` is a 10-line public facade.
- Focused context and visual input modules are 94 and 152 lines.
- Core typecheck, targeted investigation regressions, full Core, evaluation,
  document-engine, desktop typecheck/build, and whitespace checks pass.
- The facade preserves the existing investigation input exports and the
  focused modules do not import the facade.

### Current structural task: Work Discovery repository boundaries (phase 35)

Split the Work Discovery persistence repository behind its existing public
module path. Separate session persistence, example persistence, and snapshot
plus replay-case persistence while preserving SQL statements, JSON validation,
record shapes, ordering, upsert behavior, and public exports.

### Success criteria

- `store/repositories/work-discovery-repository.ts` remains a stable public
  facade and is <= 60 lines.
- Focused repository modules each remain <= 220 lines and have one clear
  persistence responsibility.
- Work Discovery repository and related persistence regressions remain green.
- Full Core, evaluation, document-engine, desktop typecheck/build, and
  whitespace checks remain green.

### Non-goals

- Changing database schema, SQL semantics, JSON error codes, record shapes,
  ordering, upsert behavior, or public exports.
- Refactoring Work Discovery service logic, unrelated repositories, UI, or
  tests until this slice is verified.

### Baseline (2026-09-02T21:01:05.5474513+09:00)

- `store/repositories/work-discovery-repository.ts` is 297 lines and combines
  session, example, snapshot, and replay-case persistence.
- The structural shape check fails as expected because the public module is
  297 lines and the focused directory does not exist yet.
- Core typecheck passes, and the Work Discovery repository/persistence/service
  regression passes 25/25.

### Final (2026-09-02T21:05:22.7137079+09:00)

- `store/repositories/work-discovery-repository.ts` is a 24-line public
  facade.
- Focused contracts, parsing, sessions, examples, snapshots, and replay-case
  modules are 33, 49, 58, 54, 72, and 39 lines.
- Core typecheck, targeted Work Discovery regressions, full Core, evaluation,
  document-engine, desktop typecheck/build, and whitespace checks pass.
- The facade preserves the existing repository exports and focused modules do
  not import the facade.

### Current structural task: PDF form verification boundaries (phase 36)

Split the PDF form verification module behind its existing import path.
Separate page/template geometry checks, native widget value checks, overlay
value checks, and final output reopening while preserving private helper names
used by the fill pipeline, error codes, coordinate handling, and resource
cleanup.

### Success criteria

- `write/pdf_form_engine/verification/__init__.py` remains a stable facade and
  is <= 60 lines.
- Focused verification modules each remain <= 220 lines and have one clear
  responsibility.
- PDF form and document-engine regressions remain green.
- Full Core, evaluation, document-engine, desktop typecheck/build, and
  whitespace checks remain green.

### Non-goals

- Changing PDF form field matching, geometry tolerances, coordinate transforms,
  native/overlay verification semantics, error codes, or public/internal
  import names.
- Refactoring PDF analysis, filling, primitives, UI, or tests until this slice
  is verified.

### Baseline (2026-09-02T21:08:09.3470853+09:00)

- `write/pdf_form_engine/verification.py` is 317 lines and combines page
  geometry, template field, native widget, overlay, and output verification.
- The structural shape check fails as expected because the public module is
  317 lines and the focused directory does not exist yet.
- The verification helper import check passes with the document-engine source
  path configured, and the full document-engine regression passes 37/37.

### Final (2026-09-02T21:15:14.2522742+09:00)

- `write/pdf_form_engine/verification/__init__.py` is an 18-line public
  facade.
- Focused geometry, native value, overlay value, and output verification
  modules are 94, 160, 55, and 43 lines.
- Core typecheck, document-engine import/compile checks, full document-engine,
  Core, evaluation, desktop typecheck/build, and whitespace checks pass.
- The existing `write.pdf_form_engine.verification` import path and fill
  pipeline remain intact; focused modules do not import the facade.

### Current structural task: PDF form analysis boundaries (phase 37)

Split the PDF form analysis module behind its existing import path. Separate
digital PDF discovery, OCR text candidates, OCR geometry candidates, OCR
pipeline orchestration, layout-hint normalization, and final template
assembly while preserving field shapes, confidence values, engine/mode
selection, warnings, ordering, and import names.

### Success criteria

- `write/pdf_form_engine/analysis/__init__.py` remains a stable facade and is
  <= 120 lines.
- Focused analysis modules each remain <= 220 lines and have one clear
  responsibility.
- Existing analysis helper imports and document-engine regressions remain
  green.
- Full Core, evaluation, document-engine, desktop typecheck/build, and
  whitespace checks remain green.

### Non-goals

- Changing PDF field detection, OCR behavior, geometry, confidence values,
  warnings, engine/mode selection, metadata, or public/internal import names.
- Refactoring PDF filling, verification, primitives, UI, or tests until this
  slice is verified.

### Baseline (2026-09-02T21:17:10.0435020+09:00)

- `write/pdf_form_engine/analysis.py` is 528 lines and combines digital
  detection, OCR text and geometry detection, layout hints, and template
  assembly.
- The structural shape check fails as expected because the public module is
  528 lines and the focused directory does not exist yet.
- Existing analysis helper imports pass, and the full document-engine
  regression passes 37/37.

### Final (2026-09-02T21:22:39.6438174+09:00)

- `write/pdf_form_engine/analysis/__init__.py` is a 90-line public facade.
- Focused digital, hints, OCR text, OCR geometry, and OCR pipeline modules
  are 148, 50, 119, 166, and 28 lines.
- Analysis imports/compile, document-engine 37/37, Core 707 passed with
  3 skipped, eval 11/11, desktop typecheck/build, and whitespace checks pass.
- The existing `write.pdf_form_engine.analysis` import path and helper
  exports remain intact; focused modules do not import the facade.

### Current structural task: Workspace flow panel boundaries (phase 38)

Split the Workspace flow panel behind its existing import path. Separate
flow-state resolution from stage/copy presentation helpers and React rendering
while preserving status precedence, stage indices, labels, messages, replay
summary display, approval display, error recovery copy, and existing exports.

### Success criteria

- `apps/desktop/src/components/workspace/WorkspaceFlowPanel.tsx` remains a
  stable facade/component and is <= 140 lines.
- Focused flow modules each remain <= 220 lines and have one clear
  responsibility.
- Existing Workspace flow tests remain green.
- Desktop typecheck/build, Core, evaluation, document-engine, and whitespace
  checks remain green.

### Non-goals

- Changing flow status precedence, stage numbering, labels, copy, CSS classes,
  approval/error semantics, component props, or public exports.
- Refactoring unrelated Workspace components, hooks, UI styling, or tests
  until this slice is verified.

### Baseline (2026-09-02T21:25:07.9012282+09:00)

- `apps/desktop/src/components/workspace/WorkspaceFlowPanel.tsx` is 340 lines
  and combines flow-state calculation, display rules, and React rendering.
- The structural shape check fails as expected because the public component is
  340 lines and the focused directory does not exist yet.
- Desktop typecheck passes, and the Workspace flow regression passes 10/10.

### Final (2026-09-02T21:28:58.1512359+09:00)

- `apps/desktop/src/components/workspace/WorkspaceFlowPanel.tsx` is a
  124-line component facade.
- Focused flow model and view modules are 180 and 67 lines.
- Workspace flow 10/10, desktop typecheck/build, Core 707 passed with
  3 skipped, eval 11/11, document-engine 37/37, and whitespace checks pass.
- Existing pure-flow exports and component props remain available from the
  original module path; focused modules do not import the facade.

### Current structural task: Workflow draft-to-flow boundaries (phase 39)

Split the desktop workflow graph compiler behind its existing import path.
Separate graph contracts/context, node emission, and recursive branch/edge
assembly while preserving trigger and Gmail helper steps, placeholder and
branch topology, edge labels, node display data, layout, animation indices,
change markers, and existing exports.

### Success criteria

- `apps/desktop/src/workflow/draft-to-flow.ts` remains a stable facade and is
  <= 120 lines.
- Focused draft-to-flow modules each remain <= 220 lines and have one clear
  responsibility.
- A focused workflow graph regression covers empty, linear, branch, Gmail,
  and missing-draft behavior.
- Desktop typecheck/build, Core, evaluation, document-engine, and whitespace
  checks remain green.

### Non-goals

- Changing graph node/edge data, trigger behavior, Gmail injection, branch
  topology, layout settings, display copy, animation ordering, or public
  import names.
- Refactoring unrelated workflow UI, core catalog/display behavior, or tests
  until this slice is verified.

### Baseline (2026-09-02T21:33:06.1123079+09:00)

- `apps/desktop/src/workflow/draft-to-flow.ts` is 303 lines and combines
  graph contracts, node emission, recursive sequence handling, and top-level
  layout assembly; the focused directory does not exist yet.
- Desktop typecheck passes, and the existing Core visual-display regression
  passes 7/7.

### Final (2026-09-02T21:41:44.3803937+09:00)

- `apps/desktop/src/workflow/draft-to-flow.ts` is a 107-line public facade.
- Focused context, contracts, node-emission, and sequence modules are 17,
  24, 126, and 85 lines.
- The focused workflow graph regression passes 5/5, covering missing, empty,
  linear, branch, and Gmail-injected graphs.
- Desktop typecheck/build, Core 707 passed with 3 skipped, eval 11/11,
  document-engine 37/37, dependency-direction, and whitespace checks pass.
- The existing `draftToFlow` import path and public types remain available;
  focused modules do not import the facade.

### Current structural task: Workspace sidebar boundaries (phase 40)

Split the desktop Workspace sidebar behind its existing import path. Separate
navigation, saved-work rendering, settings/connector rendering, status
messages, and recent-session rendering while preserving DOM structure, copy,
active states, callbacks, accessibility labels, connector counts, AI
selection behavior, and existing exports.

### Success criteria

- apps/desktop/src/components/layout/WorkspaceSidebar.tsx remains a stable
  facade and is <= 140 lines.
- Focused sidebar modules each remain <= 220 lines and have one clear
  responsibility.
- Desktop typecheck/build and the full project regressions remain green.

### Non-goals

- Changing sidebar layout, styles, copy, navigation semantics, connector
  status rules, AI selection behavior, callbacks, or public import names.
- Refactoring App.tsx, settings screens, hooks, or tests until this slice is
  verified.

### Baseline (2026-09-02T21:46:41.0722289+09:00)

- WorkspaceSidebar.tsx is 407 lines and combines navigation, saved-work
  actions, settings and connector rows, status messages, and recent sessions.
- The focused sidebar directory does not exist yet.
- Desktop typecheck/build pass before implementation.

### Final (2026-09-02T21:50:11.5930868+09:00)

- WorkspaceSidebar.tsx is a 102-line public facade.
- Focused model, navigation, session, settings, status, and work modules are
  74, 56, 53, 174, 17, and 57 lines.
- Desktop typecheck/build, Core 707 passed with 3 skipped, eval 11/11,
  document-engine 37/37, dependency-direction, and whitespace checks pass.
- The existing WorkspaceSidebar import and all callbacks remain available;
  focused modules do not import the facade.

### Current structural task: Workspace chat hook boundaries (phase 41)

Split the desktop Workspace chat hook behind its existing import path.
Separate shared async context, session loading/reset, message send/save,
workflow approval, and workspace-source operations while preserving session
epoch guards, request busy/progress behavior, IPC call order, optimistic and
persisted messages, workflow mapping, approval errors, source updates, and
the public hook return shape.

### Success criteria

- apps/desktop/src/hooks/useWorkspaceChat.ts remains a stable facade and is
  <= 220 lines.
- Focused workspace-chat modules each remain <= 220 lines and have one clear
  responsibility.
- The existing useWorkspaceChat import, WorkspaceWorkflowState export, option
  type, and returned action names remain compatible.
- Desktop typecheck/build, Core, evaluation, document-engine, and whitespace
  checks remain green.

### Non-goals

- Changing IPC call order, state transitions, epoch/request guards, error
  messages, optimistic persistence, workflow mapping, approval semantics,
  source attachment behavior, or public hook names.
- Refactoring App.tsx, chat rendering, IPC contracts, or tests until this
  slice is verified.

### Baseline (2026-09-02T21:53:30.8904792+09:00)

- useWorkspaceChat.ts is 427 lines and combines lifecycle effects, session
  loading, message send/save, workflow registration and approval, and source
  attachment.
- The focused workspace-chat directory does not exist yet.
- Desktop typecheck/build pass before implementation.

### Final (2026-09-02T21:57:32.6805140+09:00)

- useWorkspaceChat.ts is a 145-line public facade.
- Focused contracts, message, session, source, and workflow action modules are
  52, 122, 148, 53, and 39 lines.
- Desktop typecheck/build, Core 707 passed with 3 skipped, eval 11/11,
  document-engine 37/37, dependency-direction, and whitespace checks pass.
- The existing hook import, WorkspaceWorkflowState export, option type, and
  returned action names remain available; focused modules do not import the
  facade.

### Current structural task: Work Discovery service boundaries (phase 42)

Split the core WorkDiscoveryService behind its existing import path. Separate
runtime lifecycle and recovery, command mutations and waiting, inspection
projection, publishing/compilation, and the public facade while preserving
all public methods, revision conflicts, status transitions, pipeline
callbacks, auto-resume behavior, and snapshot paths.

### Success criteria

- packages/core/src/work-discovery/service.ts remains a stable facade and is
  <= 120 lines.
- Focused Work Discovery service modules each remain <= 220 lines and have
  one clear responsibility.
- Existing WorkDiscoveryService options, conflict type, public methods, and
  runtime behavior remain compatible.
- Work Discovery tests, Core, evaluation, document-engine, desktop, and
  whitespace checks remain green.

### Non-goals

- Changing discovery schemas, status transitions, recovery policy, pipeline
  ordering, snapshot storage, source reads, publishing semantics, errors, or
  public import paths.
- Refactoring the remaining Work Discovery pipeline, observation, exploration,
  synthesis, or UI modules until this slice is verified.

### Baseline (pre-patch inspection; timestamp unavailable)

- work-discovery/service.ts was 433 lines and combined construction, runtime
  lifecycle/recovery, pipeline execution, command mutations, inspection, and
  publishing.
- The focused service directory did not exist.
- The existing Work Discovery implementation had already been typechecked in
  the preceding verified project state.

### Final (2026-09-02T22:11:24.0635640+09:00)

- work-discovery/service.ts is a 97-line public facade.
- Focused commands, contracts, inspection, lifecycle, and publishing modules
  are 137, 48, 69, 180, and 47 lines.
- Work Discovery service tests pass 12/12; Core passes 707 with 3 skipped,
  evaluation 11/11, document-engine 37/37, desktop typecheck/build, module
  boundary, dependency direction, and whitespace checks pass.
- Existing WorkDiscoveryService imports, options, conflict type, public
  methods, status/recovery behavior, pipeline callbacks, auto-resume, and
  snapshot paths remain available.

### Current structural task: approval continuation boundaries (phase 43)

Split the runtime approval continuation behind its existing module path.
Separate approved-action execution from approval lookup/claim, persisted
execution snapshot recovery, checkpoint continuation, and final result
handling while preserving approval idempotency, global-off behavior,
fail-closed validation, contract checks, connector invocation, pending
approval checkpoints, execution logs, and public exports.

### Success criteria

- packages/core/src/runtime/execution/approval.ts remains a stable facade and
  is <= 200 lines.
- Focused approval modules each remain <= 220 lines and have one clear
  responsibility.
- Approval continuation and runtime execution tests remain green with the
  existing result/error semantics.
- Core, evaluation, document-engine, desktop typecheck/build, and whitespace
  checks remain green.

### Non-goals

- Changing approval state transitions, claim/resolve behavior, global
  execution gating, persisted snapshot/log validation, action parameter
  resolution, output-contract policy, connector behavior, checkpoint shape,
  result messages, or public import paths.
- Refactoring the remaining runtime execution modules until this slice is
  verified.

### Baseline (2026-09-02T22:13:18.2972146+09:00)

- runtime/execution/approval.ts is 283 lines and combines approval lifecycle,
  persisted execution recovery, approved-action execution, checkpoint
  continuation, contract validation, and final result handling.
- The focused approval directory does not exist yet.
- Core typecheck and the preceding full project regression are green.

### Final (2026-09-02T22:21:01.8582610+09:00)

- runtime/execution/approval.ts is a 175-line public facade.
- Focused approved-actions and snapshot modules are 81 and 85 lines.
- Approval regression passes 42/42; Core passes 707 with 3 skipped,
  evaluation 11/11, document-engine 37/37, desktop typecheck/build, module
  boundary, dependency direction, and whitespace checks pass.
- Existing approval continuation imports and approval idempotency, checkpoint,
  fail-closed, contract, connector, and result behavior remain intact.

### Current structural task: Workspace chat rendering boundaries (phase 44)

Split the desktop AxWorkspaceChat component behind its existing import path.
Separate message rendering, composer rendering, pure message conversion, and
empty/loading/error/discovery states while preserving the existing DOM
structure, class names, copy, conditions, callbacks, assistant interactivity,
approval actions, auto-scroll behavior, and public exports.

### Success criteria

- apps/desktop/src/components/workspace/AxWorkspaceChat.tsx remains a stable
  facade and is <= 180 lines.
- Focused chat-rendering modules each remain <= 220 lines and have one clear
  responsibility.
- Desktop typecheck/build and the full project regressions remain green.

### Non-goals

- Changing layout, CSS classes, copy, SVG data, assistant-runtime wiring,
  message IDs, callback conditions, approval semantics, discovery behavior,
  or public import paths.
- Refactoring neighboring Workspace components until this slice is verified.

### Baseline (pre-patch inspection; timestamp unavailable)

- AxWorkspaceChat.tsx was 275 lines and combined runtime wiring, message
  rendering, composer rendering, and all empty/loading/error/discovery states.
- The focused ax-workspace-chat directory did not exist yet.
- Desktop typecheck was green in the preceding verified state.

### Final (2026-09-02T22:32:44.1265186+09:00)

- AxWorkspaceChat.tsx is a 147-line public facade.
- Focused composer, messages, model, and states modules are 28, 60, 26, and
  109 lines.
- Core passes 707 with 3 skipped; evaluation 11/11; document-engine 37/37;
  desktop typecheck/build and git diff --check pass.
- Existing assistant-runtime orchestration, DOM structure, class names, copy,
  SVG, callbacks, approval actions, auto-scroll, and discovery states remain
  behind the original component import path.

### Current structural task: command chat orchestration boundaries (phase 45)

Split the core runAxCommandChat implementation behind its existing public
module path. Separate protocol/session result helpers from the bounded
command/reply loop while preserving command ordering, provider transport,
context propagation, input requests, presentations, approval/job behavior,
timeouts, cancellation, logging, and public exports.

### Success criteria

- packages/core/src/agent/commands/chat.ts remains a stable facade and is <=
  180 lines.
- Focused chat modules each remain <= 220 lines and have one clear
  responsibility.
- The focused command-chat regression and Core typecheck remain green.
- Core, evaluation, document-engine, desktop typecheck/build, and whitespace
  checks remain green.

### Non-goals

- Changing command protocol schemas, prompt content, command ordering,
  provider session behavior, context/memo propagation, result/presentation
  semantics, approval/job handling, timeout/cancellation behavior, logging,
  or public import paths.
- Refactoring unrelated command gateways or agent model modules until this
  slice is verified.

### Baseline (2026-09-02T22:34:25.0936518+09:00)

- agent/commands/chat.ts is 276 lines and combines protocol/session helpers,
  the bounded command/reply loop, timeout/cancellation, and final handling.
- The focused chat directory does not exist yet.
- Focused command-chat tests pass 17/17 and Core typecheck passes.

### Current structural task: workspace source lifecycle boundaries (phase 46)

Split the core WorkspaceSourceService behind its existing public module path.
Separate PDF ingestion/recovery and filesystem persistence/cleanup from the
service facade while preserving source status transitions, queue behavior,
manifest/docling artifacts, deduplication-aware cleanup, subscriptions,
bounded reads, and public exports.

### Success criteria

- packages/core/src/store/workspace-source-service.ts remains a stable facade
  and is <= 180 lines.
- Focused workspace-source lifecycle modules each remain <= 220 lines and
  have one clear responsibility.
- The focused WorkspaceSourceService regression and Core typecheck remain
  green.
- Core, evaluation, document-engine, desktop typecheck/build, and whitespace
  checks remain green.

### Non-goals

- Changing source IDs, session validation, artifact import/deduplication,
  status/error codes, PDF ingest behavior, queue/restart recovery, manifest
  JSON shape, document bounding, cleanup policy, notification semantics, or
  public import paths.
- Refactoring unrelated stores, document adapters, or source contracts until
  this slice is verified.

### Baseline (2026-09-02T22:41:48.2409313+09:00)

- store/workspace-source-service.ts is 251 lines and combines attachment,
  reading, ingestion/recovery, manifest persistence, notifications, and
  artifact/session cleanup.
- Focused ingestion and persistence modules do not exist yet.
- WorkspaceSourceService tests pass 5/5 and Core typecheck passes.

### Final (2026-09-02T22:46:10.8259114+09:00)

- workspace-source-service.ts is a 176-line public facade.
- Focused ingestion and persistence modules are 97 and 49 lines.
- WorkspaceSourceService tests pass 5/5; Core passes 707 with 3 skipped;
  evaluation 11/11; document-engine 37/37; desktop typecheck/build and
  git diff --check pass.
- Existing attachment, PDF ingest/recovery, source status/error handling,
  manifests, bounded reads, subscriptions, artifact cleanup, and public
  source exports remain intact.

### Current structural task: workspace assistant presentation boundaries (phase 47)

Split the desktop WorkspaceAssistantPresentation component behind its existing
public module path. Separate input controls, presentation blocks, and card
state from the list facade while preserving the existing DOM structure,
classes, labels, input batching, action callbacks, stale-card locking, and
public exports.

### Success criteria

- apps/desktop/src/components/workspace/WorkspaceAssistantPresentation.tsx
  remains a stable facade and is <= 120 lines.
- Focused presentation modules each remain <= 180 lines and have one clear
  responsibility.
- Desktop typecheck/build and the full project regressions remain green.

### Non-goals

- Changing presentation schemas, input validation, option labels, action
  values, batch/individual submission semantics, busy/interactive locking,
  DOM classes, copy, accessibility attributes, or public import paths.
- Refactoring unrelated Workspace components until this slice is verified.

### Baseline (2026-09-02T22:47:17.7426949+09:00)

- WorkspaceAssistantPresentation.tsx is 247 lines and combines input request
  controls, block rendering, card state, and the presentation list.
- The focused workspace-assistant-presentation directory does not exist yet.
- Desktop typecheck passes.

### Current structural task: discovery hook action boundaries (phase 49)

Split the desktop useDiscovery hook behind its existing public hook path.
Separate command-result normalization from discovery action orchestration
while preserving context reset behavior, polling, stale-operation guards,
start/import, question answers, publish callbacks, cancel/retry, busy/error
states, and public return values.

### Success criteria

- apps/desktop/src/hooks/useDiscovery.ts remains a stable facade and is <= 180
  lines.
- Focused discovery hook modules each remain <= 220 lines and have one clear
  responsibility.
- Desktop typecheck/build and the full project regressions remain green.

### Non-goals

- Changing discovery IPC payloads, status polling cadence, epoch guards,
  workspace context switching, state/error messages, action semantics,
  callback dependencies, or public hook return shape.
- Refactoring unrelated hooks or discovery core services until this slice is
  verified.

### Final (2026-09-02T22:54:47.9233275+09:00)

- ActivityPage.tsx is a 166-line public page facade.
- Focused activity execution item and formatting modules are 124 and 17
  lines.
- Core passes 707 with 3 skipped; evaluation 11/11; document-engine 37/37;
  desktop typecheck/build and git diff --check pass.
- Existing execution status/error mapping, timeline markup, empty state,
  explanation flow, delete behavior, PDF export states, and public import path
  remain intact.

### Final (2026-09-02T22:50:54.8478223+09:00)

- WorkspaceAssistantPresentation.tsx is a 49-line public facade.
- Focused input, block, and card modules are 91, 33, and 80 lines.
- Core passes 707 with 3 skipped; evaluation 11/11; document-engine 37/37;
  desktop typecheck/build and git diff --check pass.
- Existing input controls, option descriptions, batch/individual submission,
  action locking, stale-card behavior, DOM classes, copy, and public import
  path remain intact.

### Current structural task: activity execution item boundaries (phase 48)

Split the desktop ActivityPage execution timeline item behind its existing
public page path. Move item rendering and display formatting into focused
modules while preserving execution status mapping, error text, delete/export
callbacks, PDF save states, empty state, explanation controls, DOM classes,
and public exports.

### Success criteria

- apps/desktop/src/components/activity/ActivityPage.tsx remains a stable page
  facade and is <= 180 lines.
- Focused activity modules each remain <= 180 lines and have one clear
  responsibility.
- Desktop typecheck/build and the full project regressions remain green.

### Non-goals

- Changing activity status/error labels, timestamp or file-size formatting,
  confirmation behavior, IPC calls, PDF export semantics, explanation flow,
  timeline markup/classes, copy, or public import paths.
- Refactoring unrelated activity/settings pages until this slice is verified.

### Baseline (2026-09-02T22:51:43.3167091+09:00)

- ActivityPage.tsx is 266 lines and combines page-level state/actions with
  execution item rendering and formatting helpers.
- The focused activity execution item module does not exist yet.
- Desktop typecheck passes.

### Baseline (2026-09-02T22:55:54.1900253+09:00)

- useDiscovery.ts is 259 lines and combines result normalization,
  context/polling state, and seven discovery actions.
- The focused discovery hook directory does not exist yet.
- Desktop typecheck passes.

### Final (2026-09-02T23:01:56.6418579+09:00)

- useDiscovery.ts is a 107-line public facade.
- Focused actions and result modules are 174 and 35 lines.
- Core passes 707 with 3 skipped; evaluation 11/11; document-engine 37/37;
  desktop typecheck/build and git diff --check pass.
- Existing context reset, polling cadence, stale-operation cancellation,
  session start/import, question answers, publishing, cancel/retry, busy/error
  handling, and public return values remain intact.

## Current structural task: ArtifactStore storage-boundary split (phase 50)

Split the ArtifactStore's stored-artifact validation and persisted metadata
format helpers behind the existing public `packages/core/src/store/artifact-store.ts`
path. Keep the artifact filenames, sidecar behavior, deduplication rules,
security checks, and exported `ArtifactStore`/`StoredArtifact` contract intact.

### Success criteria

- `artifact-store.ts` remains a stable public facade and is <= 180 lines.
- Focused ArtifactStore support modules each remain <= 180 lines and have one
  clear responsibility.
- ArtifactStore focused tests, Core typecheck, and the full project evaluator
  remain green.

### Non-goals

- Changing artifact IDs, filenames, sidecar suffixes, JSON shapes, hash
  deduplication, root-containment checks, error messages, or public imports.
- Changing document-engine behavior, Work Discovery semantics, generated PDF
  persistence, or unrelated dirty worktree changes.
- Broad ArtifactStore redesign or migration beyond this internal seam.

### Baseline (2026-09-02T23:06:57.0620389+09:00)

- `artifact-store.ts` is 228 lines and the focused ArtifactStore directory does
  not exist; the module-shape check fails as intended.
- ArtifactStore focused tests pass 8/8 and Core typecheck passes.

### Final (2026-09-02T23:09:57.0357195+09:00)

- `artifact-store.ts` is a 169-line public facade; `contracts.ts` and
  `validation.ts` are 9 and 57 lines.
- The focused modules do not import the facade, and the existing
  `ArtifactStore`/`StoredArtifact` import path remains intact.
- Core passes 707 with 3 skipped; evaluation 11/11; document-engine 37/37;
  desktop typecheck/build and `git diff --check` pass.

## Current structural task: HTTP connector orchestration split (phase 81)

Split HTTP endpoint normalization, request payload normalization, and HTTP
action execution behind the existing `packages/core/src/modules/http/connector.ts`
facade. Preserve the public `HttpConnector` class, endpoint fallback and
selection rules, read-only request restrictions, URL security checks, header
filtering, body serialization, request/response logging, truncation behavior,
error details, status handling, and public imports.

### Success criteria

- `packages/core/src/modules/http/connector.ts` remains the stable public
  facade and is <= 50 lines.
- Focused modules under `packages/core/src/modules/http/connector` are <= 220
  lines and each has one clear responsibility.
- HTTP connector/request/security regression checks and Core typecheck pass.
- Desktop typecheck/build, document-engine tests, evaluation, full core tests,
  and `git diff --check` remain green.

### Non-goals

- Changing HTTP methods, endpoint matching/fallback, URL security policy,
  headers, body serialization, authentication, request limits, logs, response
  data, error codes/details, or public import paths.
- Adding HTTP features or changing desktop HTTP connection behavior.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: desktop workspace session action boundary split (phase 141)

Split workspace-chat session lifecycle/reset behavior from workspace chat and
workflow loading behavior behind the existing
`apps/desktop/src/hooks/workspace-chat/session-actions.ts` facade. Preserve
session epoch invalidation, active-request cleanup, workspace-context changes,
source/workflow loading order, stale-session guards, refresh behavior, public
action names, and error messages.

### Success criteria

- `workspace-chat/session-actions.ts` remains the stable facade and is <= 50
  lines.
- Focused session action modules under `workspace-chat/session-actions` have
  one clear responsibility and are <= 130 lines.
- Desktop typecheck/build remain green.
- The full project evaluator remains green.

### Non-goals

- Changing session state, epoch guards, reset behavior, workspace chat loading,
  workflow loading, source loading, refresh order, IPC calls, or messages.
- Changing workspace chat UI, Core chat/session modules, persistence, or
  connectors.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: desktop HTTP form model boundary split (phase 140)

Split HTTP endpoint normalization and connected-item presentation data from the
existing `useHttpConnectionForm` controller. Preserve all exported types and
imports, endpoint fallback behavior, auth metadata labels, form state,
scrolling, connect/disconnect payloads, confirmation behavior, and user-facing
messages.

### Success criteria

- `use-http-connection-form.ts` remains the stable controller/export facade and
  is <= 145 lines.
- `http-connection/model.ts` owns pure endpoint/item derivation and is <= 100
  lines.
- Desktop typecheck/build remain green.
- The full project evaluator remains green.

### Non-goals

- Changing HTTP connection payloads, auth handling, endpoint fallback or
  labels, form state transitions, confirmation behavior, UI markup, CSS, or
  connector APIs.
- Changing Core HTTP modules, IPC, persistence, or external connectors.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: desktop app action boundary split (phase 139)

Split app-level conversation management, workflow management, and approval
actions behind the existing `apps/desktop/src/app/actions.ts` factory. Preserve
the factory export, `AppActions` return shape and action order, navigation
side-effects, active-session/workspace synchronization, confirmation behavior,
refresh ordering, IPC calls, and error messages.

### Success criteria

- `app/actions.ts` remains the stable public facade and is <= 55 lines.
- Focused app action modules under `app/actions` have one clear
  responsibility and are <= 120 lines.
- Desktop typecheck/build remain green.
- The full project evaluator remains green.

### Non-goals

- Changing navigation, active-session handling, workspace chat behavior,
  confirmation dialogs, approval transitions, workflow activation, refresh
  behavior, IPC contracts, or error messages.
- Changing renderer UI, Core runtime/persistence, or connector behavior.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: desktop runtime IPC boundary split (phase 126)

Split approval, execution cleanup, and workflow activation handlers behind the
existing `apps/desktop/electron/main/ipc/runtime-handlers.ts` registration
facade. Preserve IPC channel names, input validation, approval claim and
rejection transitions, execution result/log semantics, runtime notifications,
error messages, and public imports.

### Success criteria

- `runtime-handlers.ts` remains the stable registration facade and is <= 40
  lines.
- Focused runtime handler modules under `ipc/runtime-handlers` have one clear
  responsibility and are <= 220 lines.
- Desktop typecheck/build and Core runtime regressions remain green.
- The full project evaluator remains green.

### Non-goals

- Changing approval status transitions, rejection logging, runtime execution,
  workflow activation behavior, validation, error messages, or IPC channels.
- Changing renderer APIs, Core runtime/persistence, or public imports.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: desktop activity action boundary split (phase 142)

Split the stateful activity actions for execution explanation, deletion,
clearing, and generated-PDF export behind a focused hook while preserving the
existing ActivityPage rendering, IPC calls, confirmation behavior, messages,
loading state, and public component behavior.

### Success criteria

- `apps/desktop/src/components/activity/ActivityPage.tsx` remains a screen
  composition component and is <= 110 lines.
- `apps/desktop/src/components/activity/use-activity-actions.ts` owns the
  activity action state/handlers and is <= 140 lines.
- Desktop typecheck/build and the full project evaluator remain green.

### Non-goals

- Changing activity rendering, labels, error handling, confirmation behavior,
  IPC payloads, refresh order, execution state semantics, or PDF export
  behavior.
- Changing `ActivityExecutionItem`, styles, renderer APIs, Core runtime,
  persistence, or unrelated modules.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: settings connector sections boundary split (phase 143)

Split the non-AI connector category rendering and connection-status
presentation from `SettingsHub` behind a focused component while preserving the
existing category order, labels, descriptions, badges, connection resolution,
navigation callbacks, and rendered UI.

### Success criteria

- `apps/desktop/src/components/settings/SettingsHub.tsx` remains the settings
  hub composition component and is <= 70 lines.
- `apps/desktop/src/components/settings/settings-hub/connector-sections.tsx`
  owns messaging, storage, API, and data connector sections and is <= 180
  lines.
- Desktop typecheck/build and the full project evaluator remain green.

### Non-goals

- Changing connector catalogs, status calculations, labels, descriptions,
  navigation behavior, AI hub behavior, styles, or settings APIs.
- Changing connector forms, Core connectors, persistence, IPC, or unrelated
  modules.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: settings detection lifecycle boundary split (phase 144)

Split the settings-page AI detection refresh lifecycle from the page renderer
behind a focused hook while preserving the existing refresh trigger semantics,
including hub/detail transitions, cancellation guards, detection state, and
screen validation/navigation behavior.

### Success criteria

- `apps/desktop/src/components/settings/SettingsPage.tsx` remains a screen
  composition component and is <= 65 lines.
- `apps/desktop/src/components/settings/settings-page/use-settings-detection.ts`
  owns the detection lifecycle and is <= 90 lines.
- Desktop typecheck/build and the full project evaluator remain green.

### Non-goals

- Changing AI detection API calls, refresh timing, cancellation behavior,
  screen validation, navigation, titles, subtitles, or rendered UI.
- Changing `useAiDetection`, settings content/forms, Core modules, IPC,
  persistence, or unrelated modules.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: webhook and local-folder form boundary split (phase 145)

Split the stateful connection/validation actions from the Webhook and local
folder settings form renderers behind focused hooks, matching the existing
RDB/HTTP controller-view pattern while preserving all fields, labels, messages,
confirmation behavior, connected-item presentation, callbacks, and UI state.

### Success criteria

- `WebhookConnectionForm.tsx` and `LocalFolderConnectionForm.tsx` are each
  <= 130 lines and remain the screen renderers.
- `webhook-connection/use-webhook-connection-form.ts` and
  `local-folder-connection/use-local-folder-connection-form.ts` each own their
  form state/actions and are <= 130 lines.
- Desktop typecheck/build and the full project evaluator remain green.

### Non-goals

- Changing connector payloads, validation, labels, messages, confirmation
  behavior, connected-item data, UI markup, styles, or connector APIs.
- Changing RDB/HTTP forms, Core connectors, IPC, persistence, or unrelated
  modules.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: AI brand mode panel boundary split (phase 146)

Split the CLI and API mode panels from `AiBrandForm` into focused
presentational components while preserving mode conditions, connection badges,
inputs, test buttons, disabled states, labels, and callbacks.

### Success criteria

- `AiBrandForm.tsx` remains the common brand-form composition component and is
  <= 130 lines.
- `ai/brand-form/cli-panel.tsx` and `ai/brand-form/api-panel.tsx` each own one
  mode panel and are <= 90 lines.
- Desktop typecheck/build and the full project evaluator remain green.

### Non-goals

- Changing AI provider state, readiness/verification behavior, mode selection,
  input handling, labels, messages, disabled states, styles, or IPC calls.
- Changing `AiBrandDetail`, `useAiBrandSettings`, detection, Core modules,
  persistence, or unrelated components.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: Gmail and Slack form boundary split (phase 147)

Split stateful input and connection actions from the Gmail and Slack settings
form renderers behind focused hooks, matching the existing connector
controller-view pattern while preserving OAuth readiness, capability display,
Slack realtime status messaging, token clearing, confirmation behavior, and
all existing callbacks and UI states.

### Success criteria

- `GmailConnectionForm.tsx` and `SlackConnectionForm.tsx` are each <= 130
  lines and remain the screen renderers.
- `gmail-connection/use-gmail-connection-form.ts` and
  `slack-connection/use-slack-connection-form.ts` each own form state/actions
  and are <= 100 lines.
- Desktop typecheck/build and the full project evaluator remain green.

### Non-goals

- Changing OAuth/API calls, Slack status semantics, token handling, labels,
  messages, confirmation behavior, capability display, disabled states, UI
  markup, styles, or connector APIs.
- Changing other connector forms, Core connectors, IPC, persistence, or
  unrelated modules.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: desktop discovery action boundary split (phase 137)

Split discovery-session start actions from session answer/publication/cancellation
actions behind the existing `apps/desktop/src/hooks/use-discovery/actions.ts`
facade. Preserve callback identities as far as the existing dependencies allow,
workspace/session isolation, stale-operation guards, refresh ordering, error
messages, IPC payloads, and the hook's public return shape.

### Success criteria

- `use-discovery/actions.ts` remains the stable public facade and is <= 90
  lines.
- Focused discovery action modules under `use-discovery` have one clear
  responsibility and are <= 150 lines.
- Desktop typecheck/build and the existing discovery hook regression remain
  green.
- The full project evaluator remains green.

### Non-goals

- Changing discovery IPC commands, payloads, session state transitions,
  workspace-context isolation, refresh behavior, error handling, or public
  hook return names.
- Changing discovery UI, Core discovery modules, persistence, or external
  connectors.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: desktop AI brand action boundary split (phase 138)

Split AI brand mode selection, connection verification, and configuration
save/activation actions behind the existing
`apps/desktop/src/hooks/ai-brand-settings/actions.ts` factory. Preserve the
factory export, returned action names, provider-specific model selection,
verification state, secret handling, user-facing messages, refresh order, and
IPC payloads.

### Success criteria

- `ai-brand-settings/actions.ts` remains the stable public facade and is <= 70
  lines.
- Focused AI brand action modules under `ai-brand-settings` have one clear
  responsibility and are <= 150 lines.
- Desktop typecheck/build remain green.
- The full project evaluator remains green.

### Non-goals

- Changing AI provider selection, model resolution, API key or CLI testing,
  activation/save behavior, secrets, state transitions, messages, or refresh
  ordering.
- Changing AI settings UI, IPC contracts, Core AI modules, or persistence.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: Work Discovery pipeline replay boundary (phase 132)

Separate the Work Discovery pipeline's candidate replay, replay-case
persistence, clarification decision, and final state patching from the existing
pipeline runner. Preserve checkpoint recovery, source inventory collection,
candidate ordering, replay records, clarification questions, blueprint
creation, budgets, status transitions, and public imports.

### Success criteria

- `packages/core/src/work-discovery/pipeline.ts` remains a stable public facade
  and is <= 40 lines.
- The pipeline runner keeps lifecycle/source-collection orchestration while
  replay completion lives in a focused module with one clear responsibility.
- Existing Work Discovery service, replay, clarification, Core, evaluation,
  document-engine, desktop, and whitespace checks remain green.
- The full project evaluator remains green.

### Non-goals

- Changing discovery state transitions, source reads, snapshots, replay
  semantics, clarification/blueprint decisions, budgets, persistence, errors,
  or public imports.
- Changing connectors, workflow compilation, UI behavior, or persistence
  schema.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: AI decision loop boundary (phase 133)

Separate the AI decision investigation loop from input preparation and policy
validation behind the existing `runtime/ai-investigation.ts` export path.
Preserve investigation read limits, capability-read parameters, evidence
tracking, cloud-data policy, vision inputs, declared-output validation, result
persistence, log messages, and public imports.

### Success criteria

- `runtime/ai-investigation.ts` and `runtime/investigation/run-decision.ts`
  remain stable caller-facing seams with unchanged exports and behavior.
- The investigation loop and final-conclusion handling live in a focused
  internal module with one clear responsibility.
- AI investigation tests, full Core/evaluation, document-engine, desktop, and
  whitespace checks remain green.
- The full project evaluator remains green.

### Non-goals

- Changing prompt wording, provider calls, read limits, data filtering,
  evidence rules, output schema semantics, error messages, logs, or result
  persistence.
- Changing workflow schema, connectors, UI, credentials, or external delivery.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: command chat loop boundary (phase 134)

Separate the bounded model-command loop from timeout setup, session lifecycle,
and public exports in `agent/commands/chat.ts`. Preserve provider transport
normalization, command execution context, host callbacks, session/workflow
state updates, protocol-failure handling, job confirmation behavior, timeout
messages, max-round behavior, and public imports.

### Success criteria

- `agent/commands/chat.ts` remains the stable public facade and is <=110 lines.
- The command loop lives in a focused internal module with one clear
  responsibility and is <=220 lines.
- Command chat tests, full Core/evaluation, document-engine, desktop, and
  whitespace checks remain green.
- The full project evaluator remains green.

### Non-goals

- Changing command protocol/schema, transport selection, command access,
  connector behavior, callbacks, session persistence, timeout values, or
  user-facing messages.
- Changing UI, credentials, workflow semantics, or external delivery.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: sidebar settings component boundary (phase 136)

Separate the reusable connection-status, settings-link-icon, and AI-brand-row
presentation components from the sidebar settings panel assembly. Preserve
connector status labels/counts, AI readiness/selection behavior, settings
routing, accessibility labels, CSS classes, and public imports.

### Success criteria

- `workspace-sidebar/settings-panel.tsx` remains the stable panel entry point
  and is <=110 lines.
- Focused sidebar settings presentation modules under
  `workspace-sidebar/settings-panel` have one clear responsibility and are
  <=180 lines.
- Desktop typecheck/build and the full project evaluator remain green.

### Non-goals

- Changing sidebar layout, labels, status semantics, AI selection behavior,
  connector routing, CSS, accessibility text, or settings APIs.
- Changing Core, IPC, persistence, or external connectors.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: workflow node detail model boundary (phase 135)

Separate connector/settings resolution and read-only node detail derivation from
the React rendering in `workflow/NodeDetailPanel.tsx`. Preserve node lookup,
trigger/action/AI/approval/condition detail lines, connector guidance, settings
links, field rendering, labels, prompts, CSS classes, and public imports.

### Success criteria

- `NodeDetailPanel.tsx` remains the stable component entry point and is <=130
  lines.
- Pure node-detail helpers live under `workflow/node-detail` in a focused
  module of <=180 lines.
- Desktop typecheck/build and existing Core/evaluation/document-engine checks
  remain green.
- The full project evaluator remains green.

### Non-goals

- Changing any rendered text, layout, CSS class, connector settings routing,
  field values, edit prompts, or component props.
- Changing workflow schemas, runtime behavior, connectors, or persistence.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: desktop workflow graph boundary split (phase 127)

Split graph-state calculation and React effects from the existing
`apps/desktop/src/workflow/WorkflowGraph.tsx` view while preserving graph node
and edge output, diff/completeness handling, collapse behavior, fit-view timing,
auto-selection, selection callbacks, and public component behavior.

### Success criteria

- `WorkflowGraph.tsx` remains the stable public component and is <= 120 lines.
- Focused workflow-graph modules have one clear responsibility and are <= 220
  lines.
- Workflow graph regression, Desktop typecheck, and production build remain
  green.
- The full project evaluator remains green.

### Non-goals

- Changing graph layout, node/edge data, ReactFlow options, animation timing,
  selection semantics, toolbar/empty-state copy, or public imports.
- Changing Core workflow contracts or unrelated renderer components.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: desktop E2E seam boundary split (phase 128)

Split the deterministic document-engine client, timing controls, and chat
scenario contract/runner from the existing
`apps/desktop/electron/main/e2e-test-seam.ts` facade. Preserve E2E command
tokens, deterministic replies, document-ingest failure behavior, environment
delay bounds, public exports, and the no-network/no-provider test boundary.

### Success criteria

- `e2e-test-seam.ts` remains the stable public facade and is <= 40 lines.
- Focused E2E seam modules have one clear responsibility and are <= 220 lines.
- Product QA deterministic smoke, Desktop typecheck/build, and relevant E2E
  regressions remain green.
- The full project evaluator remains green.

### Non-goals

- Changing E2E tokens, fixture data, response text, delay semantics, document
  engine behavior, provider/connector isolation, or public imports.
- Changing product runtime behavior or renderer code.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: Desktop Ax API contract boundary split (phase 129)

Split the renderer/preload API contract into focused runtime, workspace,
connector, AI, and discovery interfaces behind the existing
`apps/desktop/src/types/ax-api.ts` facade. Preserve the `AxApi` name,
`Window.ax` global contract, method names, argument/return shapes, optional
members, and generated-artifact result type.

### Success criteria

- `ax-api.ts` remains the stable public facade and is <= 80 lines.
- Focused Ax API contract modules have one clear responsibility and are <= 220
  lines.
- Desktop typecheck/build and relevant renderer/API regressions remain green.
- The full project evaluator remains green.

### Non-goals

- Changing IPC channels, preload implementations, renderer behavior, payload
  shapes, optionality, or public `AxApi`/`Window.ax` names.
- Changing Core contracts or unrelated type modules.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: workspace flow model boundary split (phase 130)

Split workspace flow contracts, status/stage rules, and presentation resolution
behind the existing `apps/desktop/src/components/workspace/workspace-flow/model.ts`
facade. Preserve status precedence, stage indexes, Korean labels/messages,
latest execution lookup, discovery handling, approval handling, public exports,
and renderer behavior.

### Success criteria

- `workspace-flow/model.ts` remains the stable public facade and is <= 40 lines.
- Focused workspace-flow modules have one clear responsibility and are <= 220
  lines.
- Workspace flow regression, Desktop typecheck, and production build remain
  green.
- The full project evaluator remains green.

### Non-goals

- Changing flow status precedence, stage values, copy, execution/discovery
  semantics, approval presentation, public imports, or CSS-facing status names.
- Changing Core contracts or unrelated workspace components.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current bug task: Docling structure helper imports (phase 131)

Restore the missing internal imports used by
`packages/document-engine/src/adapters/docling_engine/structure.py` and add
regression coverage for native-page classification and visual-page image
preparation. Preserve page classification, render scale, image paths, and all
existing document-engine behavior.

### Success criteria

- Structure classification and visual-page preparation no longer raise
  `NameError` on their normal helper paths.
- A focused regression test covers both previously unresolved helpers.
- The full document-engine test suite and project evaluator remain green.

### Non-goals

- Changing OCR heuristics, page classification rules, render scales, image
  generation, manifest shape, or unrelated document-engine modules.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: generated PDF export IPC seam split (phase 125)

Split generated-artifact contracts, filename/path validation, export
orchestration, default filesystem dependencies, and IPC registration behind
the existing `apps/desktop/electron/main/ipc/artifact-handlers.ts` facade.
Preserve artifact lookup, PDF-only validation, generated-root containment,
size/hash verification, dialog cancellation, path redaction, and public
imports.

### Success criteria

- `artifact-handlers.ts` remains the stable public facade and is <= 40 lines.
- Focused artifact handler modules under `ipc/artifact-handlers` have one clear
  responsibility and are <= 220 lines.
- Desktop typecheck/build and all generated PDF export regressions remain
  green.
- The full project evaluator remains green.

### Non-goals

- Changing artifact IDs, PDF validation, filename sanitization, root/path/hash
  checks, dialog behavior, copy behavior, error redaction, or public imports.
- Changing ArtifactStore, renderer export behavior, IPC channels, or
  persistence.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: Desktop AI IPC seam split (phase 124)

Split AI provider inspection/configuration, provider persistence, CLI/API
testing, and environment-secret handlers behind the existing
`apps/desktop/electron/main/ipc/ai-handlers.ts` registration facade. Preserve
IPC channel names, input validation, secret masking/storage, provider
migration, and public registration imports.

### Success criteria

- `ai-handlers.ts` remains the stable IPC registration facade and is <= 40
  lines.
- Focused AI handler modules under `ipc/ai-handlers` have one clear
  responsibility and are <= 220 lines.
- Desktop typecheck/build remains green and all handler registration callers
  compile.
- The full project evaluator remains green.

### Non-goals

- Changing IPC channel names, payload validation, error messages, secret
  masking/storage, provider migration, or response shapes.
- Changing renderer AI settings, Core AI modules, provider behavior, or
  persistence schema.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: Desktop app-state IPC seam split (phase 123)

Split execution/approval projections, workflow summaries, connector status,
and AI/environment state assembly behind the existing
`apps/desktop/electron/main/ipc/state-handlers.ts` registration facade.
Preserve the `ax:getState` payload, quality-state mapping, snapshot error
handling, connector redaction, and public registration import.

### Success criteria

- `state-handlers.ts` remains the stable IPC registration facade and is <= 40
  lines.
- Focused state modules under `ipc/state-handlers` have one clear
  responsibility and are <= 220 lines.
- Desktop typecheck/build remains green and the state facade callers compile.
- The full project evaluator remains green.

### Non-goals

- Changing the `ax:getState` channel, payload fields, ordering semantics,
  quality-state mapping, approval snapshot behavior, or connector redaction.
- Changing renderer state types, Core state/persistence, or IPC contracts.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: renderer connection-summary seam split (phase 122)

Split connector-specific renderer summary projections behind the existing
`apps/desktop/electron/main/ipc/connection-state-summary.ts` facade. Preserve
the redaction of RDB credentials, HTTP legacy fallback fields, Webhook listener
health, Gmail account projection, and public imports.

### Success criteria

- `connection-state-summary.ts` remains the stable public facade and is <= 40
  lines.
- Focused summary modules under `ipc/connection-state-summary` have one clear
  responsibility and are <= 220 lines.
- Desktop typecheck/build and the connection-summary regression remain green.
- The full project evaluator remains green.

### Non-goals

- Changing renderer payload fields, secret redaction, connector health
  semantics, legacy fallback behavior, or public imports.
- Changing Core connector modules, IPC channels, persistence, or connector
  behavior.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: desktop Slack connection seam split (phase 121)

Split Slack secret parsing/storage, persisted metadata projection, and secure
connector hydration behind the existing
`apps/desktop/electron/main/slack/connection.ts` facade. Preserve secret
formats, unreadable-secret recovery, legacy plaintext migration, connector
state, public types, and public imports.

### Success criteria

- `slack/connection.ts` remains the stable public facade and is <= 40 lines.
- Focused Slack connection modules under `main/slack/connection` have one
  clear responsibility and are <= 220 lines.
- Desktop typecheck/build and the Slack connection regression remain green.
- The full project evaluator remains green.

### Non-goals

- Changing secret names, secret serialization, unreadable-secret behavior,
  legacy migration, metadata projection, connector state, or public imports.
- Changing Slack provider behavior, IPC payloads, Core Slack modules, or
  persistence schema.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: desktop Gmail OAuth connection seam split (phase 120)

Split Gmail legacy migration, secure credential hydration, OAuth connection,
profile lookup, and disconnect operations behind the existing
`apps/desktop/electron/main/gmail/connection.ts` facade. Preserve OAuth
credentials, legacy record migration, connector state, error formatting, and
public imports.

### Success criteria

- `gmail/connection.ts` remains the stable public facade and is <= 40 lines.
- Focused Gmail connection modules under `main/gmail/connection` have one
  clear responsibility and are <= 220 lines.
- Desktop typecheck/build and the Gmail OAuth connection regression remain
  green.
- The full project evaluator remains green.

### Non-goals

- Changing OAuth scopes, credential serialization, legacy migration, profile
  lookup behavior, connector state, error formatting, or public imports.
- Changing Core Gmail modules, IPC payloads, provider behavior, or persistence
  schema.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: transform connector responsibility split (phase 82)

Split table-input normalization, table/document text conversion, and transform
action execution behind the existing `packages/core/src/modules/transform/connector.ts`
facade. Preserve the public `TransformConnector` class, table artifact shape,
source IDs, text formatting, transform expression validation/evaluation,
variable writes, output paths, result kinds, and error codes/messages.

### Success criteria

- `packages/core/src/modules/transform/connector.ts` remains the stable public
  facade and is <= 50 lines.
- Focused modules under `packages/core/src/modules/transform/connector` are
  <= 220 lines and each has one clear responsibility.
- Transform connector regression checks and Core typecheck pass.
- Desktop typecheck/build, document-engine tests, evaluation, full core tests,
  and `git diff --check` remain green.

### Non-goals

- Changing table/document conversion output, transform DSL validation or
  evaluation, variable mutation, output paths, result kinds, errors, or public
  import paths.
- Adding transform actions or changing workflow/runtime behavior.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: AI settings catalog split (phase 83)

Split provider/brand catalog definitions and model-output/helper logic behind
the existing `packages/core/src/agent/settings/catalog.ts` facade. Preserve
all catalog values, enabled-brand ordering, model normalization/exclusion,
Codex model parsing JSON/text fallback behavior, helper results, and public
imports used by settings, CLI detection, model resolution, and the desktop.

### Success criteria

- `packages/core/src/agent/settings/catalog.ts` remains the stable public
  facade and is <= 40 lines.
- Focused modules under `packages/core/src/agent/settings/catalog` are <= 220
  lines and each has one clear responsibility.
- Settings catalog/parser regression checks and Core typecheck pass.
- Desktop typecheck/build, document-engine tests, evaluation, full core tests,
  and `git diff --check` remain green.

### Non-goals

- Changing provider metadata, brand catalog values, enabled brands, default
  models, model filtering, parser behavior, settings resolution, or public
  import paths.
- Adding providers/models or changing desktop settings behavior.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: CLI output handling split (phase 84)

Split CLI output readability/filtering, Cursor stream-event handling, provider
failure extraction, and structured-result parsing behind the existing
`packages/core/src/agent/model/cli/output.ts` facade. Preserve all public
exports, noise filtering, stdout/stderr precedence, Cursor progress/session/
result extraction, Codex error parsing, fallback messages, schema validation,
and diagnostics.

### Success criteria

- `packages/core/src/agent/model/cli/output.ts` remains the stable public
  facade and is <= 40 lines.
- Focused modules under `packages/core/src/agent/model/cli/output` are <= 220
  lines and each has one clear responsibility.
- CLI output/provider regression checks and Core typecheck pass.
- Desktop typecheck/build, document-engine tests, evaluation, full core tests,
  and `git diff --check` remain green.

### Non-goals

- Changing CLI output parsing, Cursor event semantics, error messages,
  provider behavior, schema validation, or public import paths.
- Adding provider features or changing model adapters beyond the internal
  module boundary.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: structured JSON parser split (phase 85)

Split JSON text extraction/control-character repair, structured-output wrapper
candidate discovery, and schema application behind the existing
`packages/core/src/agent/model/cli-json/parser.ts` facade. Preserve fenced and
explanatory-output extraction, error diagnostics, control-character repair,
wrapper candidate order/deduplication, Zod validation, and public exports.

### Success criteria

- `packages/core/src/agent/model/cli-json/parser.ts` remains the stable parser
  facade and is <= 40 lines.
- Focused modules under `packages/core/src/agent/model/cli-json/parser` are
  <= 220 lines and each has one clear responsibility.
- CLI JSON/parser regression checks and Core typecheck pass.
- Desktop typecheck/build, document-engine tests, evaluation, full core tests,
  and `git diff --check` remain green.

### Non-goals

- Changing JSON extraction, repair, wrapper handling, schema validation,
  diagnostics, error messages, or public import paths.
- Changing Codex schema conversion or provider adapter behavior.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: desktop AI config boundary split (phase 86)

Split AI TOML parsing/serialization, file persistence, and OS secret/env
handling behind the existing `apps/desktop/electron/main/ai/config-file.ts`
facade. Preserve config paths, TOML syntax and defaults, provider preferences,
environment-key mapping, OS credential-store access, migration behavior,
secret redaction boundaries, and all public imports.

### Success criteria

- `config-file.ts` remains the stable public facade and is <= 50 lines.
- Focused modules under `apps/desktop/electron/main/ai/config-file` are <= 220
  lines and each has one clear responsibility.
- Desktop typecheck/build and AI configuration import contracts pass.
- Core tests, evaluation, document-engine tests, and `git diff --check` remain
  green.

### Non-goals

- Changing AI config path selection, TOML format, defaults, provider/model
  settings, environment-key mapping, credential-store behavior, migration,
  or public import paths.
- Adding providers, changing secret storage, or changing IPC/settings UX.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: workflow schema split (phase 71)

Split workflow limits, trigger schemas, step schemas, workflow document schema,
and parse/validation helpers behind the existing `workflow/schema.ts` facade.
Preserve every public export, Zod default/transform/constraint, inferred type,
parse normalization rule, and validation error behavior.

### Success criteria

- `packages/core/src/workflow/schema.ts` remains the stable public facade and is
  <= 40 lines.
- Focused modules under `packages/core/src/workflow/schema` have one clear
  responsibility and are <= 220 lines.
- Workflow schema, action-definition, persisted-document, discovery-compile,
  and evaluation regressions remain green.
- Core typecheck and the full project evaluator remain green.

### Non-goals

- Changing workflow schema shapes, defaults, transforms, limits, messages, or
  public import paths.
- Changing workflow compilation, contract validation, runtime execution,
  persistence, or UI behavior.
- Adding new workflow types or validation rules.

### Baseline (2026-09-03T01:19:29.0022044+09:00)

- `workflow/schema.ts` is 182 lines and the focused schema directory is
  absent; the structural check fails as intended.
- Workflow schema/action-definition/persisted-document/discovery-compile/eval
  regression passes 28/28 and Core typecheck passes.

### Final (2026-09-03T01:23:27.6223189+09:00)

- `workflow/schema.ts` is a 5-line public facade; focused modules are
  `limits.ts` 3 lines, `triggers.ts` 46, `steps.ts` 68, `workflow.ts` 35,
  and `parse.ts` 41.
- Existing schemas, defaults, transforms, limits, parse normalization, and
  public imports remain unchanged; focused workflow schema regression passes
  28/28.
- Core passes 707 with 3 skipped; evaluation 11/11; document-engine 37/37;
  desktop typecheck/build, dependency-direction, module-shape, and
  `git diff --check` pass.

## Current structural task: workflow repair rewrite split (phase 75)

Split transform-expression renaming, persisted document rewriting, action-step
rewriting, output-contract rewriting, and repair-candidate application behind
the existing `workflow/repair/rewrite.ts` import path. Preserve selected
candidate validation, protected workflow fields, JSON behavior, and public
exports.

### Success criteria

- `packages/core/src/workflow/repair/rewrite.ts` remains the stable public
  facade and is <= 30 lines.
- Focused modules under `packages/core/src/workflow/repair/rewrite` have one
  clear responsibility and are <= 220 lines.
- Workflow repair and historical replay regressions, Core typecheck, and the
  full project evaluator remain green.

### Non-goals

- Changing repair candidate schemas, applicability checks, protected fields,
  fingerprint behavior, replay semantics, or error messages.
- Changing transform evaluation, workflow persistence, runtime execution, or
  public import paths.
- Adding new repair operations or changing repair policy.

### Baseline (2026-09-03T01:46:04.2776945+09:00)

- `workflow/repair/rewrite.ts` is 194 lines and the focused rewrite directory
  is absent; the structural check fails as intended.
- Workflow repair and historical replay regression passes 5/5 and Core
  typecheck passes.

### Final (2026-09-03T01:50:11.3101629+09:00)

- `workflow/repair/rewrite.ts` is a 1-line public facade; focused modules are
  `expression.ts` 102 lines, `apply.ts` 40, `document.ts` 28, and `step.ts` 34.
- Existing candidate validation, expression/document/contract rewrites,
  protected fields, error behavior, and public imports remain unchanged;
  focused repair/replay regression passes 5/5.
- Core passes 707 with 3 skipped; evaluation 11/11; document-engine 37/37;
  desktop typecheck/build, dependency-direction, module-shape, and
  `git diff --check` pass.

## Current structural task: scheduler cron split (phase 74)

Split cron/timezone matching from scheduler lifecycle execution behind the
existing `runtime/scheduler.ts` import path. Preserve the public
`ScheduledJob`, `cronMatches`, and `Scheduler` exports, firing/retry behavior,
generation guards, and persistence semantics.

### Success criteria

- `packages/core/src/runtime/scheduler.ts` remains the stable public facade and
  is <= 40 lines.
- Focused modules under `packages/core/src/runtime/scheduler` have one clear
  responsibility and are <= 220 lines.
- Scheduler lifecycle, cron, capability-graph, Core typecheck, and full project
  regressions remain green.

### Non-goals

- Changing cron parsing/matching, timezone handling, firing/retry behavior,
  execution dispatch, lifecycle generation, or persisted settings.
- Changing workflow triggers, runtime execution, or public import paths.
- Adding scheduling features or changing timer intervals.

### Baseline (2026-09-03T01:38:30.0310192+09:00)

- `runtime/scheduler.ts` is 196 lines and the focused scheduler directory is
  absent; the structural check fails as intended.
- Scheduler/cron/capability-graph regression passes 30/30 and Core typecheck
  passes.

### Final (2026-09-03T01:42:31.3248317+09:00)

- `runtime/scheduler.ts` is a 3-line public facade; focused modules are
  `cron.ts` 59 lines and `service.ts` 138 lines.
- Existing cron/timezone matching, scheduler lifecycle, retry behavior,
  generation guards, persisted settings, and public imports remain unchanged;
  focused scheduler regression passes 30/30.
- Core passes 707 with 3 skipped; evaluation 11/11; document-engine 37/37;
  desktop typecheck/build, dependency-direction, module-shape, and
  `git diff --check` pass.

## Current structural task: document-engine type contract split (phase 72)

Split document ingest/result contracts, engine transport contracts, and PDF
conversion/form contracts behind the existing `document-engine/types.ts` and
package index exports. Preserve every public type name, field optionality,
literal union, and import path.

### Success criteria

- `packages/core/src/document-engine/types.ts` remains the stable public facade
  and is <= 30 lines.
- Focused modules under `packages/core/src/document-engine/types` have one clear
  responsibility and are <= 220 lines.
- Document-engine client, PDF read/write, artifact normalization, design-tool,
  Core typecheck, and the full project evaluator remain green.

### Non-goals

- Changing document-engine request/response shapes or runtime behavior.
- Changing PDF conversion, form analysis/fill, rendering, worker selection, or
  connector behavior.
- Adding new document formats or modifying public package exports.

### Baseline (2026-09-03T01:27:05.2368231+09:00)

- `document-engine/types.ts` is 186 lines and the focused type directory is
  absent; the structural check fails as intended.
- Document-engine client, PDF read/write, artifact normalization, and
  design-tool regression passes 21/21 and Core typecheck passes.

### Final (2026-09-03T01:30:08.5742586+09:00)

- `document-engine/types.ts` is a 3-line public facade; focused modules are
  `ingest.ts` 58 lines, `transport.ts` 12, and `pdf.ts` 114.
- Existing public types, optionality, literal unions, and package exports remain
  unchanged; focused document-engine regression passes 21/21.
- Core passes 707 with 3 skipped; evaluation 11/11; document-engine 37/37;
  desktop typecheck/build, dependency-direction, module-shape, and
  `git diff --check` pass.

## Current structural task: canvas graph validation split (phase 73)

Split canvas draft structure validation, reference extraction/validation, and
semantic graph rules behind the existing `validate-graph.ts` import path.
Preserve issue ordering, messages, parsing behavior, public exports, and the
builder's validation boundary.

### Success criteria

- `packages/core/src/workflow/canvas/compile/validate-graph.ts` remains the
  stable public facade and is <= 40 lines.
- Focused modules under `packages/core/src/workflow/canvas/compile/validate-graph`
  have one clear responsibility and are <= 220 lines.
- Canvas compile, draft, revision, slot, Core typecheck, and full project
  regressions remain green.

### Non-goals

- Changing draft schema shapes, issue ordering, messages, graph rules, or
  public import paths.
- Changing canvas compilation, node conversion, runtime execution, or UI.
- Adding new graph validation rules or changing parse strictness.

### Baseline (2026-09-03T01:32:40.6305107+09:00)

- `validate-graph.ts` is 191 lines and the focused validation directory is
  absent; the structural check fails as intended.
- Canvas compile/draft/revision/slot regression passes 18/18 and Core
  typecheck passes.

### Final (2026-09-03T01:36:26.2304803+09:00)

- `validate-graph.ts` is a 4-line public facade; focused modules are
  `types.ts` 4 lines, `structure.ts` 41, `references.ts` 75, and `graph.ts` 93.
- Existing graph checks, issue ordering, messages, parser behavior, and the
  builder import seam remain unchanged; focused canvas regression passes 18/18.
- Core passes 707 with 3 skipped; evaluation 11/11; document-engine 37/37;
  desktop typecheck/build, dependency-direction, module-shape, and
  `git diff --check` pass.

## Current structural task: Work Discovery repair replay split (phase 61)

Split historical snapshot loading, virtual table repair, replay-case
evaluation, and candidate aggregation behind the existing `repair.ts` import
path. Preserve replay results, unavailable reasons, path safety, schema
validation, transform evaluation, and public exports.

### Success criteria

- `packages/core/src/work-discovery/repair.ts` remains a stable facade and is
  <= 80 lines.
- Focused repair modules under `packages/core/src/work-discovery/repair` are
  <= 220 lines and each has one clear responsibility.
- Historical repair regression, Core typecheck, and the full project evaluator
  remain green.

### Non-goals

- Changing replay status/reason values, snapshot path validation, table rename
  behavior, observation comparison, workflow repair application, or public
  import paths.
- Refactoring Work Discovery synthesis, persistence, or unrelated runtime
  modules in this slice.
- Adding repair operations or changing user-visible behavior.

### Baseline (2026-09-03T00:18:01.9896118+09:00)

- `repair.ts` is 222 lines and combines snapshot loading, table rewriting,
  replay evaluation, and aggregation; the focused repair directory does not
  exist.
- Historical repair regression passes 2/2 and Core typecheck passes.

## Current structural task: PDF form primitives split (phase 62)

Split the PDF form engine's primitive constants, value/widget helpers, and
field geometry helpers behind the existing `primitives` import path. Preserve
field IDs, coordinates, AcroForm interpretation, placeholder detection,
schema constants, and all private helper imports used by analysis, fill, and
verification.

### Success criteria

- The existing `pdf_form_engine.primitives` import path remains available as a
  stable package facade and is <= 80 lines.
- Focused primitive modules under `packages/document-engine/src/write/pdf_form_engine/primitives`
  are <= 220 lines and each has one clear responsibility.
- The document-engine test suite and the full project evaluator remain green.

### Non-goals

- Changing PDF form analysis, fill, overlay, native widget handling, fonts,
  verification, field geometry, or public Python import paths.
- Refactoring Docling, PDF-to-HTML, or unrelated document-engine modules in
  this slice.
- Adding form features or changing generated PDF output.

### Baseline (2026-09-03T00:26:17.0119102+09:00)

- `primitives.py` is 231 lines and combines constants, value/widget helpers,
  page geometry, AcroForm extraction, and placeholder field creation; the
  focused primitives package does not exist.
- Document-engine regression passes 37/37.

## Current structural task: execution result message split (phase 63)

Split execution-result formatting, inline approval projection, and workspace
chat persistence behind the existing `execution-result-message.ts` import
path. Preserve bounded output, status/error/approval copy, workflow action
summaries, execution-to-chat mapping, and idempotent updates.

### Success criteria

- `packages/core/src/runtime/execution-result-message.ts` remains a stable
  facade and is <= 80 lines.
- Focused modules under `packages/core/src/runtime/execution-result` are <=
  220 lines and each has one clear responsibility.
- Execution result regression, Core typecheck, and the full project evaluator
  remain green.

### Non-goals

- Changing result text, output truncation, status/error/approval semantics,
  action summary labels, chat mapping, persistence behavior, or public imports.
- Refactoring execution storage, approval repositories, workspace chat, or
  unrelated runtime modules in this slice.
- Adding result fields or changing user-visible behavior.

### Baseline (2026-09-03T00:31:04.9974855+09:00)

- `execution-result-message.ts` is 211 lines and combines result formatting
  with workspace-chat persistence and inline approval projection; the focused
  directory does not exist.
- Execution result regression passes 5/5 and Core typecheck passes.

## Current structural task: manual run input split (phase 64)

Split manual-run workflow predicates, connected-folder file selection, and
Gmail message enrichment behind the existing `manual-run-input.ts` import
path. Preserve folder precedence, extension inference, trigger-shaped input,
Gmail lookup behavior, validation errors, and public exports.

### Success criteria

- `packages/core/src/runtime/manual-run-input.ts` remains a stable facade and
  is <= 100 lines.
- Focused modules under `packages/core/src/runtime/manual-run-input` are <=
  220 lines and each has one clear responsibility.
- Manual-run regression, Core typecheck, and the full project evaluator remain
  green.

### Non-goals

- Changing folder selection precedence, file sorting, extension handling,
  Gmail query/payloads, validation messages, or public import paths.
- Refactoring local-folder scanning, Gmail connectors, or manual workflow
  execution in this slice.
- Adding input sources or changing user-visible behavior.

### Baseline (2026-09-03T00:35:57.4797868+09:00)

- `manual-run-input.ts` is 218 lines and combines workflow predicates, folder
  selection, Gmail enrichment, and validation; the focused directory does not
  exist.
- Manual-run regression passes 11/11 and Core typecheck passes.

### Final (2026-09-03T00:39:23.9987160+09:00)

- `manual-run-input.ts` is a 64-line facade; focused modules are
  `folder.ts` 92 lines, `gmail.ts` 39 lines, and `predicates.ts` 45 lines.
- Existing folder precedence, extension inference, Gmail lookup, validation
  messages, and public exports remain unchanged; focused modules do not import
  the facade.
- Core passes 707 with 3 skipped; evaluation 11/11; document-engine 37/37;
  desktop typecheck/build and `git diff --check` pass.

### Final (2026-09-03T00:35:17.1237637+09:00)

- `execution-result-message.ts` is a 3-line facade; focused modules are
  `format.ts` 116 lines, `publish.ts` 92 lines, and `contracts.ts` 5 lines.

## Current structural task: work discovery schema split (phase 70)

Split Work Discovery status/recovery enums, persisted models, command argument
schemas, and inspect-view types behind the existing `schema.ts` import path.
Preserve all Zod schemas, inferred types, defaults, validation constraints, and
public exports.

### Success criteria

- `packages/core/src/work-discovery/schema.ts` remains a stable facade and is
  <= 40 lines.
- Focused Work Discovery schema modules are <= 220 lines and each has one clear
  responsibility.
- Work Discovery, repository, compile, Core typecheck, and the full project
  evaluator remain green.

### Non-goals

- Changing Zod schema shapes, defaults, validation constraints, inferred types,
  or public import paths.
- Changing Work Discovery state transitions, persistence, compilation, or
  runtime behavior.
- Refactoring Work Discovery runtime modules until this slice is verified.

### Baseline (2026-09-03T01:10:30.5732501+09:00)

- `work-discovery/schema.ts` is 197 lines and combines status enums, persisted
  models, command args, and inspect-view types.
- Work Discovery/repository/compile regression passes 23/23 and Core typecheck
  passes.

### Final (2026-09-03T01:13:43.4771952+09:00)

- `schema.ts` is a 4-line facade; focused modules are `status.ts` 30 lines,
  `models.ts` 94 lines, `commands.ts` 42 lines, and `view.ts` 37 lines.
- Existing Zod schemas, defaults, constraints, inferred types, and public
  imports remain unchanged; focused modules do not import the facade.
- Core passes 707 with 3 skipped; evaluation 11/11; document-engine 37/37;
  desktop typecheck/build and `git diff --check` pass.

## Current structural task: database schema split (phase 69)

Split database DDL and legacy migration operations behind the existing
`applyMigrations` import path. Preserve SQL text, migration order, legacy column
renames, compatibility columns, indexes, recovery update, and public exports.

### Success criteria

- `packages/core/src/store/db/schema.ts` remains a stable facade and is <= 40
  lines.
- Focused database schema modules are <= 220 lines and each has one clear
  responsibility.
- Database migration and workflow persistence regressions, Core typecheck, and
  the full project evaluator remain green.

### Non-goals

- Changing table definitions, column names, defaults, foreign keys, indexes,
  migration order, legacy recovery behavior, or public import paths.
- Changing database adapters, repositories, runtime behavior, or persistence
  semantics.
- Refactoring unrelated database modules until this slice is verified.

### Baseline (2026-09-03T01:06:07.2120182+09:00)

- `store/db/schema.ts` is 198 lines and combines initial DDL, legacy column
  migrations, compatibility columns, indexes, and recovery updates.
- DB migration and workflow persistence regression passes 10/10 and Core
  typecheck passes.

### Final (2026-09-03T01:09:28.3049836+09:00)

- `schema.ts` is an 8-line facade; focused modules are `ddl.ts` 146 lines and
  `legacy.ts` 50 lines.
- Existing SQL text, migration order, legacy compatibility behavior, and public
  imports remain unchanged; focused modules do not import the facade.
- Core passes 707 with 3 skipped; evaluation 11/11; document-engine 37/37;
  desktop typecheck/build and `git diff --check` pass.

## Current structural task: workflow node display split (phase 68)

Split workflow node display construction into focused action, AI, and flow
display modules behind the existing `node-display.ts` import path. Preserve all
labels, summaries, captions, tooltips, completeness flags, card styles, and
public exports.

### Success criteria

- `packages/core/src/workflow/visual-display/node-display.ts` remains a stable
  facade and is <= 40 lines.
- Focused node display modules are <= 220 lines and each has one clear
  responsibility.
- Visual-display and trigger-display regressions, Core typecheck, and the full
  project evaluator remain green.

### Non-goals

- Changing display strings, card layout data, tooltip content, connector labels,
  truncation behavior, completeness rules, or public import paths.
- Changing canvas schemas, runtime behavior, or user-visible design decisions.
- Refactoring trigger display or unrelated visual modules until this slice is
  verified.

### Baseline (2026-09-03T01:01:30.3762147+09:00)

- `visual-display/node-display.ts` is 195 lines and combines action, AI, and
  flow-node display construction with capability cards and edit prompts.
- Visual-display and trigger-display regression passes 7/7 and Core typecheck
  passes.

### Final (2026-09-03T01:05:12.3701584+09:00)

- `node-display.ts` is a 5-line facade; focused modules are `action.ts` 82
  lines, `ai.ts` 31 lines, `flow.ts` 48 lines, and `resolve.ts` 66 lines.
- Existing display strings, card structures, tooltips, completeness flags, and
  public imports remain unchanged; focused modules do not import the facade.
- Core passes 707 with 3 skipped; evaluation 11/11; document-engine 37/37;
  desktop typecheck/build and `git diff --check` pass.

## Current structural task: binding inference split (phase 67)

Split workflow binding inference into focused action-input, AI decision, and
branch traversal modules behind the existing `inferWorkflowBindings` import
path. Preserve binding precedence, trigger source handling, branch guarantees,
output discovery, and public exports.

### Success criteria

- `packages/core/src/workflow/bindings/inference.ts` remains a stable facade and
  is <= 40 lines.
- Focused binding inference modules are <= 220 lines and each has one clear
  responsibility.
- Binding regression, webhook mapping regression, Core typecheck, and the full
  project evaluator remain green.

### Non-goals

- Changing binding precedence, concrete parameter detection, trigger mapping,
  AI output contracts, branch merge semantics, or public import paths.
- Changing workflow schema, capability ports, contract validation, or runtime
  behavior.
- Refactoring unrelated binding modules until this slice is verified.

### Baseline (2026-09-03T00:56:19.4687572+09:00)

- `workflow/bindings/inference.ts` is 204 lines and combines action binding,
  AI binding, and recursive branch traversal.
- Binding and webhook mapping regression passes 15/15 and Core typecheck passes.

### Final (2026-09-03T01:00:31.2558618+09:00)

- `inference.ts` is a 25-line facade; focused modules are `infer-action.ts`
  47 lines, `infer-ai.ts` 53 lines, and `infer-sequence.ts` 97 lines.
- Existing binding precedence, trigger source handling, branch guarantees,
  output discovery, and public imports remain unchanged; focused modules do not
  import the facade.
- Core passes 707 with 3 skipped; evaluation 11/11; document-engine 37/37;
  desktop typecheck/build and `git diff --check` pass.

## Current structural task: sequence validation split (phase 66)

Split workflow sequence contract validation into focused step-contract,
branch-merge, and recursive traversal modules behind the existing
`validateSequence` import path. Preserve contract issue ordering, available
types, guaranteed sources, and recursive branch behavior.

### Success criteria

- `packages/core/src/workflow/contract-validation/sequence.ts` remains a stable
  facade and is <= 40 lines.
- Focused modules under `packages/core/src/workflow/contract-validation/sequence`
  are <= 220 lines and each has one clear responsibility.
- Contract-validator regression, Core typecheck, and the full project evaluator
  remain green.

### Non-goals

- Changing contract compatibility, binding resolution, available-type merging,
  guaranteed-source semantics, issue messages, or public import paths.
- Changing workflow schema, structural validation, action definitions, or runtime
  behavior.
- Refactoring unrelated contract-validation modules until this slice is
  verified.

### Baseline (2026-09-03T00:51:29.8513766+09:00)

- `contract-validation/sequence.ts` is 192 lines and combines step contract
  checks, branch availability merging, and recursive sequence traversal.
- Contract-validator regression passes 19/19 and Core typecheck passes.

### Final (2026-09-03T00:55:22.6084473+09:00)

- `sequence.ts` is a 1-line facade; focused modules are `steps.ts` 114 lines,
  `branches.ts` 30 lines, and `validate.ts` 55 lines.
- Existing contract issue ordering, available types, guaranteed sources,
  recursive branch behavior, and public imports remain unchanged; focused
  modules do not import the facade.
- Core passes 707 with 3 skipped; evaluation 11/11; document-engine 37/37;
  desktop typecheck/build and `git diff --check` pass.

## Current structural task: workflow structure validation split (phase 65)

Split workflow structure validation into focused action-contract, control-flow,
notification-branch, and reference-validation modules behind the existing
`validateWorkflowStructure` import path. Preserve issue ordering, validation
messages, options, and public exports.

### Success criteria

- `packages/core/src/workflow/contract-validation/structure/validate.ts`
  remains a stable facade and is <= 100 lines.
- Focused modules under the same directory are <= 220 lines and each has one
  clear responsibility.
- Contract-validator regression, Core typecheck, and the full project evaluator
  remain green.

### Non-goals

- Changing validation rules, issue ordering, messages, options, or public import
  paths.
- Changing workflow schema, sequence validation, action definitions, trigger
  semantics, or runtime behavior.
- Refactoring unrelated contract-validation modules until this slice is
  verified.

### Baseline (2026-09-03T00:42:16.9876633+09:00)

- `structure/validate.ts` is 213 lines and combines trigger, action contract,
  control-flow, notification-branch, and reference validation.
- Contract-validator regression passes 19/19 and Core typecheck passes.
- Existing result text, approval projection, chat mapping, and idempotent
  persistence remain unchanged; focused modules do not import the facade.
- Core passes 707 with 3 skipped; evaluation 11/11; document-engine 37/37;
  desktop typecheck/build and `git diff --check` pass.

### Final (2026-09-03T00:48:09.6614786+09:00)

- `structure/validate.ts` is a 30-line facade; focused modules are
  `action-contracts.ts` 61 lines, `control-flow.ts` 97 lines,
  `notifications.ts` 38 lines, and `references-validation.ts` 54 lines.
- Existing validation rules, issue ordering, messages, options, and public
  imports remain unchanged; focused modules do not import the facade.
- Core passes 707 with 3 skipped; evaluation 11/11; document-engine 37/37;
  desktop typecheck/build and `git diff --check` pass.

### Final (2026-09-03T00:29:59.7081740+09:00)

- The stable `primitives` facade is 15 lines; focused modules are
  `constants.py` 8 lines, `values.py` 110 lines, and `fields.py` 132 lines.
- Existing Python imports and PDF form behavior remain unchanged; focused
  primitive modules do not import the facade.
- Document-engine passes 37/37; Core passes 707 with 3 skipped; evaluation
  11/11; desktop typecheck/build and `git diff --check` pass.

## Current structural task: workflow binding runtime split (phase 60)

Split the runtime binding resolver and parameter application logic behind the
existing workflow binding import paths. Preserve all binding resolution,
artifact extraction, trigger mapping, AI decision context, snapshot table
merging, folder-source precedence, and public exports.

### Success criteria

- `packages/core/src/workflow/bindings/runtime.ts` remains a stable runtime
  facade and is <= 80 lines.
- Focused runtime modules under `packages/core/src/workflow/bindings/runtime`
  are <= 220 lines and each has one clear responsibility.
- Binding regression, Core typecheck, and the full project evaluator remain
  green.

### Non-goals

- Changing binding semantics, output extraction, trigger payload mapping,
  parameter precedence, snapshot handling, or public import paths.
- Refactoring inference, port contracts, step execution, or unrelated runtime
  modules in this slice.
- Adding new workflow features or changing user-visible behavior.

### Baseline (2026-09-03T00:10:02.4462595+09:00)

- `runtime.ts` is 230 lines and combines value resolution with parameter
  application; the focused runtime directory does not exist.
- Binding regression passes 13/13 and Core typecheck passes.

### Final (2026-09-03T00:16:20.8803177+09:00)

- `runtime.ts` is a 9-line facade; focused `resolve.ts` is 141 lines and
  `apply.ts` is 89 lines.
- Existing runtime exports and binding behavior remain unchanged; focused
  modules do not import the runtime facade.
- Core passes 707 with 3 skipped; evaluation 11/11; document-engine 37/37;
  desktop typecheck/build and `git diff --check` pass.

## Current structural task: AI brand settings hook split (phase 59)

Split the AI brand settings hook's per-brand initialization and async action
orchestration behind the existing `useAiBrandSettings` import path. Preserve
the hook's state, derived readiness/status values, provider selection, IPC
payloads, refresh behavior, messages, and returned action names.

### Success criteria

- `useAiBrandSettings.ts` remains the stable hook facade and is <= 180 lines.
- Focused modules under `hooks/ai-brand-settings` are <= 220 lines and each
  has one clear responsibility.
- AI settings consumers compile and the full project evaluator remains green.

### Non-goals

- Changing AI provider selection, initialization timing, readiness rules,
  IPC payloads, verification state, messages, refresh behavior, or return shape.
- Changing AI settings components, Electron handlers, provider catalogs, or
  product behavior.
- Adding new AI settings features or changing the public hook import path.

### Baseline (2026-09-03T00:02:45.2094409+09:00)

- `useAiBrandSettings.ts` is 229 lines and the focused ai-brand-settings
  directory does not exist; the module-shape check fails as intended.
- AI settings consumers and Core/Desktop typechecks pass.

### Final (2026-09-03T00:06:32.9648050+09:00)

- `useAiBrandSettings.ts` is a 127-line hook facade; focused modules are
  `actions.ts` 166 lines and `initialization.ts` 68 lines.
- Provider initialization, readiness/status derivation, selection, IPC
  payloads, verification state, messages, refresh behavior, and return shape
  remain unchanged.
- Core passes 707 with 3 skipped; evaluation 11/11; document-engine 37/37;
  desktop typecheck/build and `git diff --check` pass.

## Current structural task: Slack message formatter split (phase 58)

Split the Slack formatter's Markdown conversion, source metadata, Block Kit
construction, and fallback payload composition behind the existing
`format-message.ts` module. Preserve all public exports, rendered mrkdwn,
source-line behavior, block limits, truncation, and fallback text semantics.

### Success criteria

- `format-message.ts` remains the stable formatter facade and is <= 80 lines.
- Focused modules under `modules/slack/format-message` are <= 220 lines and
  each has one clear responsibility.
- Slack formatter tests, Core typecheck, and the full project evaluator remain
  green.

### Non-goals

- Changing Markdown conversion, source extraction, block structure, length
  limits, fallback text, connector payloads, or public import paths.
- Changing Slack transport behavior or adding formatting features.
- Refactoring unrelated connectors, parsers, or runtime behavior.

### Baseline (2026-09-02T23:57:55.4897538+09:00)

- `format-message.ts` is 227 lines and the focused formatter directory does
  not exist; the module-shape check fails as intended.
- Slack formatter tests and Core typecheck pass.

### Final (2026-09-03T00:01:23.6773260+09:00)

- `format-message.ts` is an 11-line stable facade; focused modules are
  `blocks.ts` 90 lines, `markdown.ts` 52 lines, `payload.ts` 45 lines, and
  `source.ts` 45 lines.
- Markdown conversion, source extraction, block structure and limits,
  truncation, fallback text, and all existing public exports remain intact.
- Slack formatter tests pass 10/10; Core passes 707 with 3 skipped;
  evaluation 11/11; document-engine 37/37; desktop typecheck/build and
  `git diff --check` pass.

## Current structural task: canvas node builder split (phase 57)

Split the canvas compiler's node conversion, trigger construction, and draft
normalization behind the existing `builder/nodes.ts` module. Preserve the
current step output, approval consolidation, trigger inputs, Gmail injection,
lenient validation behavior, and normalized draft semantics.

### Success criteria

- `nodes.ts` remains the stable builder facade and is <= 80 lines.
- Focused modules under `workflow/canvas/compile/builder/nodes` are <= 220
  lines and each has one clear responsibility.
- Canvas compiler regression, Core typecheck, and the full project evaluator
  remain green.

### Non-goals

- Changing node-to-step fields, capability resolution, error behavior,
  approval handling, trigger payloads, input lists, or draft normalization.
- Changing canvas callers, workflow schema, or runtime behavior.
- Adding compiler features or changing the public `./nodes.js` import path.

### Baseline (2026-09-02T23:53:33.4030767+09:00)

- `nodes.ts` is 238 lines and the focused nodes directory does not exist;
  the module-shape check fails as intended.
- Canvas compiler tests and Core typecheck pass.

### Final (2026-09-02T23:56:54.9018645+09:00)

- `nodes.ts` is a 7-line stable facade; focused modules are `steps.ts` 124
  lines, `triggers.ts` 105 lines, and `normalize.ts` 10 lines.
- Step conversion, approval consolidation, trigger construction and input
  lists, Gmail injection, lenient validation, and draft normalization remain
  unchanged.
- Canvas tests pass 24/24; Core passes 707 with 3 skipped; evaluation 11/11;
  document-engine 37/37; desktop typecheck/build and `git diff --check` pass.

## Current structural task: command definition catalog split (phase 56)

Split the command definition catalog into focused read/core, workflow, and
discovery catalogs while preserving the existing `COMMAND_DEFINITIONS` export,
exact command order, descriptions, argument metadata, lifecycle values, and
mutation flags.

### Success criteria

- `definitions.ts` remains the stable catalog facade and is <= 80 lines.
- Focused catalog modules under `agent/commands/contract/definitions` are
  <= 220 lines and each owns one command family.
- Command contract regression, Core typecheck, and the full project evaluator
  remain green.

### Non-goals

- Changing command names, descriptions, args, lifecycle or mutation metadata,
  command dispatch, validation, or public import paths.
- Adding commands, changing agent behavior, or refactoring unrelated command
  services.
- Changing the catalog's order or introducing runtime lookup behavior.

### Baseline (2026-09-02T23:46:40.4734177+09:00)

- `definitions.ts` is 271 lines and the focused definitions directory does not
  exist; the module-shape check fails as intended.
- Command contract tests and Core typecheck pass.

### Final (2026-09-02T23:52:08.9259615+09:00)

- `definitions.ts` is a 10-line stable facade; focused catalogs are
  `core.ts` 109 lines, `workflow.ts` 111 lines, and `discovery.ts` 56 lines.
- All 35 command declarations retain their existing names, order,
  descriptions, argument metadata, lifecycle values, and mutation flags.
- Related command tests pass 60/60; Core passes 707 with 3 skipped;
  evaluation 11/11; document-engine 37/37; desktop typecheck/build and
  `git diff --check` pass.

## Current structural task: HTTP request internals split (phase 55)

Split the HTTP request implementation's contracts, authentication-header
merging, and bounded response-body reading behind the existing `request.ts`
module. Preserve the current public exports, redirect policy, timeout and
size-limit behavior, authentication semantics, and probe fallback behavior.

### Success criteria

- `request.ts` remains the stable HTTP request facade and is <= 180 lines.
- Focused modules under `modules/http/request` are <= 220 lines and each has
  one clear responsibility.
- HTTP request/probe tests, Core typecheck, and the full project evaluator
  remain green.

### Non-goals

- Changing request methods, URL normalization, redirect blocking, timeout,
  response-size limits, authentication, headers, or error codes.
- Changing HTTP connector/OpenAPI callers, network policy, or product behavior.
- Adding new request features or changing the public `./request.js` import path.

### Baseline (2026-09-02T23:40:42.8702575+09:00)

- `request.ts` is 223 lines and the focused request directory does not exist;
  the module-shape check fails as intended.
- HTTP request/probe tests and Core typecheck pass.

### Final (2026-09-02T23:44:49.7752203+09:00)

- `request.ts` is a 133-line request/probe facade; focused modules are
  `body.ts` 49 lines, `contracts.ts` 32 lines, and `headers.ts` 31 lines.
- Public exports, redirect blocking, timeout and response-size limits,
  authentication semantics, headers, error codes, and probe fallback remain
  unchanged.
- HTTP request/probe tests pass 25/25; Core passes 707 with 3 skipped;
  evaluation 11/11; document-engine 37/37; desktop typecheck/build and
  `git diff --check` pass.

## Current structural task: Settings page content split (phase 54)

Move the settings page's large screen-content branching behind the existing
`SettingsPage` component path. Preserve the exact settings screen routing,
connector props, effects, rendered order, labels, classes, and public import.

### Success criteria

- `SettingsPage.tsx` remains the stable page facade and is <= 180 lines.
- Focused modules under `components/settings/settings-page` are <= 220 lines
  and each has one clear responsibility.
- Desktop typecheck/build and the full project evaluator remain green.

## Current structural task: RDB client responsibility split (phase 76)

Split RDB table-reference/policy helpers, driver client opening, table
discovery, and row reads behind the existing `modules/rdb/client.ts` facade.
Preserve the exact public exports, PostgreSQL date parsing, SQLite read-only
behavior, MySQL/PostgreSQL parameterization, table allowlists, row limits,
error messages, and connector/config callers.

### Success criteria

- `packages/core/src/modules/rdb/client.ts` remains the stable public facade
  and is <= 40 lines.
- Focused modules under `packages/core/src/modules/rdb/client` are <= 220
  lines and each has one clear responsibility.
- RDB client, connector, config, and core typecheck regression checks pass.
- Desktop typecheck/build, document-engine tests, evaluation, full core tests,
  and `git diff --check` remain green.

### Non-goals

- Changing RDB connection config, query payloads, table/schema allowlist
  semantics, read-only guarantees, row-limit behavior, driver behavior, or
  error messages.
- Changing public import paths or adding database features/drivers.
- Refactoring the connector, config, discovery source, unrelated modules, or
  existing dirty worktree changes in this slice.

## Current structural task: repair command gateway split (phase 77)

Split repair command result contracts, shared formatting, and the list,
inspect, apply, and reject command handlers behind the existing
`repair-gateway.ts` entry point. Preserve command validation, replay safety,
workflow version checks, persistence ordering, error statuses/messages, and
the existing gateway import contract.

### Success criteria

- `packages/core/src/agent/commands/repair-gateway.ts` remains the stable
  gateway facade and is <= 40 lines.
- Focused modules under `packages/core/src/agent/commands/repair-gateway` are
  <= 220 lines and each has one clear responsibility.
- Repair command service behavior and Core typecheck regression checks pass.
- Desktop typecheck/build, document-engine tests, evaluation, full core tests,
  and `git diff --check` remain green.

### Non-goals

- Changing repair command schemas, result tuples, validation, replay policy,
  workflow version checks, persistence ordering, statuses, error codes, or
  user-visible messages.
- Changing public import paths, adding repair operations, or refactoring the
  central command dispatcher in this slice.
- Refactoring unrelated modules or existing dirty worktree changes.

### Baseline (2026-09-03T02:13:51.0937942+09:00)

- `oauth.ts` is 171 lines and the focused Gmail OAuth directory does not
  exist; the module-shape check fails as intended.
- Gmail OAuth tests pass 2/2 and Core typecheck passes.

## Current structural task: webhook listener transport split (phase 78)

Split webhook request transport utilities and request-to-event handling behind
the existing `triggers/webhook/listener.ts` class. Preserve the public
listener types/class, server start/stop lifecycle, method/path checks, payload
limits, authentication, sensitive-header filtering, provider event IDs,
event payload shape, response statuses/bodies, and error handling.

### Success criteria

- `packages/core/src/triggers/webhook/listener.ts` remains the stable public
  listener facade and is <= 100 lines.
- Focused modules under `packages/core/src/triggers/webhook/listener` are <=
  220 lines and each has one clear responsibility.
- Webhook listener/security regression checks and Core typecheck pass.
- Desktop typecheck/build, document-engine tests, evaluation, full core tests,
  and `git diff --check` remain green.

### Non-goals

- Changing webhook authentication, path normalization, payload limits,
  sensitive-header policy, event IDs, event payloads, response statuses/bodies,
  server lifecycle, or public import paths.
- Adding webhook methods/features or changing trigger-engine behavior.
- Refactoring unrelated modules or existing dirty worktree changes.

### Baseline (2026-09-03T02:07:53.8229742+09:00)

- `listener.ts` is 197 lines and the focused listener directory does not
  exist; the module-shape check fails as intended.
- Webhook listener/security tests and Core typecheck pass.

## Current structural task: Gmail OAuth boundary split (phase 79)

Split Gmail loopback OAuth flow/state handling from connector configuration and
profile lookup behind the existing `modules/gmail/oauth.ts` facade. Preserve
PKCE/state security, loopback binding, callback validation, timeout and server
cleanup, token requirements, OAuth scopes, connector config mapping, profile
lookup behavior, public exports, and error messages.

### Success criteria

- `packages/core/src/modules/gmail/oauth.ts` remains the stable public facade
  and is <= 50 lines.
- Focused modules under `packages/core/src/modules/gmail/oauth` are <= 220
  lines and each has one clear responsibility.
- Gmail OAuth regression checks and Core typecheck pass.
- Desktop typecheck/build, document-engine tests, evaluation, full core tests,
  and `git diff --check` remain green.

### Non-goals

- Changing OAuth scopes, PKCE/state generation or comparison, redirect path,
  loopback host/port, timeout, token validation, connector config mapping,
  profile lookup, error messages, or public import paths.
- Adding providers/scopes or changing desktop Gmail connection behavior.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: CLI process runner split (phase 80)

Split synchronous CLI execution, streaming CLI execution, and shared argument
and output limits behind the existing `agent/model/cli-process/runner.ts`
facade. Preserve command invocation resolution, stdin closing/input, stdout
and stderr capture, line callbacks, timeout/abort behavior, output/argument
limits, exit codes, error codes, public exports, and child-process options.

### Success criteria

- `packages/core/src/agent/model/cli-process/runner.ts` remains the stable
  runner facade and is <= 40 lines.
- Focused modules under `packages/core/src/agent/model/cli-process/runner`
  are <= 220 lines and each has one clear responsibility.
- CLI process regression checks and Core typecheck pass.
- Desktop typecheck/build, document-engine tests, evaluation, full core tests,
  and `git diff --check` remain green.

### Non-goals

- Changing command invocation/environment resolution, process arguments,
  stdin/stdout/stderr behavior, line callback semantics, limits, timeout/abort
  handling, exit/error codes, or public import paths.
- Adding process features or changing model adapters.
- Refactoring unrelated modules or existing dirty worktree changes.

### Baseline (2026-09-03T02:19:22.9290944+09:00)

- `runner.ts` is 168 lines and the focused runner directory does not exist;
  the module-shape check fails as intended.
- CLI process tests pass 6/6 and Core typecheck passes.

### Baseline (2026-09-03T02:02:23.0037273+09:00)

- `repair-gateway.ts` is 182 lines and the focused repair-gateway directory
  does not exist; the module-shape check fails as intended.
- Repair command service tests pass 26/26 and Core typecheck passes.

### Non-goals

- Changing settings screen behavior, effects, connector payloads, props,
  labels, rendering order, copy, or CSS classes.
- Refactoring individual connector forms, settings hooks, or unrelated UI.
- Adding new product features or changing the public `SettingsPage` import path.

### Baseline (2026-09-02T23:34:19.6765122+09:00)

- `SettingsPage.tsx` is 225 lines and the focused settings-page directory does
  not exist; the module-shape check fails as intended.
- Desktop typecheck passes.

### Final (2026-09-02T23:38:41.8969385+09:00)

- `SettingsPage.tsx` is an 81-line page facade; focused modules are
  `content.tsx` 112 lines and `contracts.ts` 54 lines.
- Settings screen routing, effects, connector props, rendered order, labels,
  copy, and CSS classes remain unchanged.
- Core passes 707 with 3 skipped; evaluation 11/11; document-engine 37/37;
  desktop typecheck/build, module-shape, dependency-direction, and
  `git diff --check` pass.

## Current structural task: RDB connection form state split (phase 53)

Move the RDB connection form's state and connection lifecycle orchestration
behind the existing `RdbConnectionForm` component path. Preserve the exact
rendered field order, labels, conditional SQLite/PostgreSQL/MySQL fields,
file-picker behavior, payload mapping, confirmation behavior, messages, and
public component import.

### Success criteria

- `RdbConnectionForm.tsx` remains the stable UI facade and is <= 180 lines.
- Focused modules under `components/settings/connectors/rdb-connection` are
  <= 220 lines and have one clear responsibility.
- Desktop typecheck/build and the full project evaluator remain green.

### Non-goals

- Changing RDB connection payloads, credential handling, allowed schema/table
  semantics, row-limit behavior, labels, form DOM/classes, success/error copy,
  or disconnect behavior.
- Refactoring other settings forms, core RDB modules, or unrelated UI/hooks.
- Adding validation, new controls, or product behavior in this slice.

### Baseline (2026-09-02T23:26:41.0793500+09:00)

- `RdbConnectionForm.tsx` is 227 lines and the focused RDB form directory
  does not exist; the module-shape check fails as intended.
- Desktop typecheck passes.

### Final (2026-09-02T23:30:07.8124546+09:00)

- `RdbConnectionForm.tsx` is a 137-line UI facade and
  `use-rdb-connection-form.ts` is 155 lines.
- SQLite/PostgreSQL/MySQL conditional fields, file picking, allowed-list and
  row-limit payload mapping, messages, confirmation behavior, and rendered
  classes remain unchanged.
- Core passes 707 with 3 skipped; evaluation 11/11; document-engine 37/37;
  desktop typecheck/build and `git diff --check` pass.

## Current structural task: HTTP connection form state split (phase 52)

Move the HTTP connection form's state and connection lifecycle orchestration
behind the existing `HttpConnectionForm` component path. Preserve the exact
rendered field order, labels, IDs, button states, messages, endpoint fallback,
authentication payload mapping, confirmation behavior, and public component
import.

### Success criteria

- `HttpConnectionForm.tsx` remains the stable UI facade and is <= 180 lines.
- Focused modules under `components/settings/connectors/http-connection` are
  <= 220 lines and have one clear responsibility.
- Desktop typecheck/build and the full project evaluator remain green.

### Non-goals

- Changing HTTP connector payloads, auth semantics, endpoint deduplication,
  labels, form DOM/classes/IDs, success/error copy, or disconnect behavior.
- Refactoring other settings forms, core HTTP modules, or unrelated UI/hooks.
- Adding validation, new controls, or product behavior in this slice.

### Baseline (2026-09-02T23:20:42.4229747+09:00)

- `HttpConnectionForm.tsx` is 248 lines and the focused HTTP form directory
  does not exist; the module-shape check fails as intended.
- Desktop typecheck passes.
- Artifact filenames, sidecars, deduplication, JSON behavior, security
  validation, and generated-artifact semantics remain unchanged.

## Current structural task: desktop App shell split (phase 51)

Split the desktop `App` shell's settings bridge and tab-content composition
behind the existing `apps/desktop/src/App.tsx` entry point. Keep the current
state ownership, workspace/session actions, IPC calls, sidebar navigation,
loading/error banner, component props, DOM structure, and default export
unchanged.

### Success criteria

- `App.tsx` remains the stable application entry facade and is <= 180 lines.
- Focused modules under `apps/desktop/src/app` are <= 220 lines and each has a
  clear shell-composition responsibility.
- Desktop typecheck/build and the full project evaluator remain green.

### Non-goals

- Changing workspace/session behavior, settings connector payloads, IPC calls,
  navigation state, error handling, rendering order, copy, or CSS classes.
- Refactoring individual settings forms, workspace components, or unrelated
  hooks in this slice.
- Adding new product features or changing the public `App` import path.

### Baseline (2026-09-02T23:12:39.7246446+09:00)

- `App.tsx` is 273 lines and the focused `src/app` directory does not exist;
  the module-shape check fails as intended.
- Desktop typecheck passes.

### Final (2026-09-02T23:17:32.9740251+09:00)

- `App.tsx` is a 112-line application facade; focused shell modules are
  `actions.ts` 150 lines, `settings-page.tsx` 81 lines, and
  `main-content.tsx` 46 lines.
- The default `App` export, state ownership, navigation, IPC calls, settings
  refresh behavior, error banner, and tab rendering remain intact.
- Core passes 707 with 3 skipped; evaluation 11/11; document-engine 37/37;
  desktop typecheck/build and `git diff --check` pass.

### Final (2026-09-02T23:24:15.5638631+09:00)

- `HttpConnectionForm.tsx` is a 157-line UI facade and
  `use-http-connection-form.ts` is 173 lines.
- Field order, labels, IDs, auth conditions, payload mapping, endpoint
  fallback, confirmation behavior, messages, and rendered classes remain
  unchanged.
- Core passes 707 with 3 skipped; evaluation 11/11; document-engine 37/37;
  desktop typecheck/build and `git diff --check` pass.

## Current structural task: CLI JSON schema boundary split (phase 87)

Split generic Zod-to-JSON-Schema conversion from Codex-specific schema
sanitization behind the existing
`packages/core/src/agent/model/cli-json/schema.ts` facade. Preserve the
generated schema shapes, optional/default handling, union behavior, Codex
top-level-object validation, error text, and all public imports.

### Success criteria

- `cli-json/schema.ts` remains the stable public facade and is <= 40 lines.
- Focused modules under `cli-json/schema` have one clear responsibility and
  are <= 220 lines.
- CLI JSON schema conversion tests and Core typecheck remain green.
- The full project evaluator remains green.

### Non-goals

- Changing Zod conversion rules, Codex sanitization rules, schema output,
  error messages, or public import paths.
- Changing CLI JSON parsing, provider adapters, investigation schemas, or
  structured-output callers.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: investigation visual input boundary split (phase 88)

Split visual-summary formatting, visual-reference collection, and image-file
loading behind the existing
`packages/core/src/runtime/investigation/input/visuals.ts` facade. Preserve
scan order, deduplication, page/path/OCR formatting, supported media rules,
size limits, error codes/messages, and all public imports.

### Success criteria

- `investigation/input/visuals.ts` remains the stable public facade and is
  <= 40 lines.
- Focused modules under `investigation/input/visuals` have one clear
  responsibility and are <= 220 lines.
- Investigation/vision-related tests and Core typecheck remain green.
- The full project evaluator remains green.

### Non-goals

- Changing visual artifact discovery, ordering, deduplication, MIME mapping,
  byte limits, error behavior, or model input shape.
- Changing investigation prompts, evidence decisions, runtime execution, or
  provider adapters.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: HTTP request boundary split (phase 89)

Split HTTP URL/limit normalization, request execution, and reachability probe
logic behind the existing
`packages/core/src/modules/http/request.ts` facade. Preserve redirect
blocking, authentication/header merging, timeout behavior, response-size
limits, HEAD handling, error codes, endpoint normalization, probe fallback,
and all public imports.

### Success criteria

- `modules/http/request.ts` remains the stable public facade and is <= 40
  lines.
- Focused modules under `modules/http/request` have one clear responsibility
  and are <= 220 lines.
- HTTP request/probe/security tests and Core typecheck remain green.
- The full project evaluator remains green.

### Non-goals

- Changing HTTP security policy, redirect handling, auth semantics, timeout or
  body limits, response mapping, probe behavior, error codes, or public import
  paths.
- Changing HTTP connector behavior, connection settings, or callers.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: local-sheet read boundary split (phase 90)

Split CSV materialization, XLSX materialization, workbook dispatch, and sheet
selection behind the existing
`packages/core/src/modules/local-sheet/read.ts` facade. Preserve workbook and
table ID derivation, row limits, CSV behavior, worksheet visibility metadata,
named ranges, first-sheet fallback, missing-sheet errors, and all public
imports.

### Success criteria

- `local-sheet/read.ts` remains the stable public facade and is <= 40 lines.
- Focused modules under `local-sheet/read` have one clear responsibility and
  are <= 220 lines.
- Local-sheet, discovery-source, and table-artifact tests plus Core typecheck
  remain green.
- The full project evaluator remains green.

### Non-goals

- Changing CSV/XLSX parsing options, table profiling, IDs, row limits,
  visibility/named-range mapping, error messages, or public import paths.
- Changing local-sheet connector behavior, discovery orchestration, or
  workbook artifact contracts.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: discovery input-schema boundary split (phase 91)

Split transform-column requirement collection, generated input-schema
construction, and existing/generated schema merging behind the existing
`packages/core/src/work-discovery/compile/compile-workflow/input-schema.ts`
facade. Preserve source discovery, column ordering, expected-type inference,
type-conflict handling, source-to-step mapping, merge precedence, and all
public imports.

### Success criteria

- `compile-workflow/input-schema.ts` remains the stable public facade and is
  <= 40 lines.
- Focused modules under `compile-workflow/input-schema` have one clear
  responsibility and are <= 220 lines.
- Discovery compile and input-contract regressions plus Core typecheck remain
  green.
- The full project evaluator remains green.

### Non-goals

- Changing transform expression traversal, inferred types, column ordering,
  source/step mapping, merge behavior, error messages, or public imports.
- Changing discovery lifecycle, candidate replay, blueprint generation, or
  runtime execution.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: output-contract boundary split (phase 92)

Split output-value resolution/classification, numeric/table range helpers, and
output-contract validation behind the existing
`packages/core/src/runtime/output-contract/output.ts` facade. Preserve nested
path lookup precedence, value-kind detection, baseline range tolerances,
issue codes/messages, field ordering, and all public imports.

### Success criteria

- `output-contract/output.ts` remains the stable public facade and is <= 40
  lines.
- Focused modules under `output-contract/output` have one clear
  responsibility and are <= 220 lines.
- Output-contract tests and Core typecheck remain green.
- The full project evaluator remains green.

### Non-goals

- Changing output lookup precedence, type classification, baseline tolerance,
  issue details, validation order, error behavior, or public import paths.
- Changing execution, approval, input-schema validation, or artifact
  contracts.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: document-engine stdio boundary split (phase 93)

Split public document-engine client operations from the low-level Python
worker request/response transport behind the existing
`packages/core/src/document-engine/engine-client/stdio.ts` facade. Preserve
worker path resolution, constructor defaults, command payloads, timeout and
environment handling, JSON parsing, exit-status checks, error text, and all
public imports.

### Success criteria

- `engine-client/stdio.ts` remains the stable public facade and is <= 40
  lines.
- Focused modules under `engine-client/stdio` have one clear responsibility
  and are <= 220 lines.
- Document-engine client integration tests and Core typecheck remain green.
- The full project evaluator remains green.

### Non-goals

- Changing worker commands, payloads, Python/environment selection, timeout
  semantics, response parsing, error codes/messages, or public import paths.
- Changing document-engine contracts, registry behavior, or document engine
  features.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: canvas panel-fields boundary split (phase 94)

Split trigger fields, node action/AI fields, source selection, and connection
guidance behind the existing
`packages/core/src/workflow/canvas/presentation/panel-fields.ts` facade.
Preserve all field labels, hints, values, required-state rules, connector
guidance, and public imports.

### Success criteria

- `presentation/panel-fields.ts` remains the stable public facade and is <= 40
  lines.
- Focused modules under `presentation/panel-fields` have one clear
  responsibility and are <= 220 lines.
- Panel-field regression tests and Core/Desktop typechecks remain green.
- The full project evaluator remains green.

### Non-goals

- Changing field ordering, labels, hints, formatting, required-state logic,
  trigger detection, connector guidance, or public import paths.
- Changing canvas draft schemas, completeness calculation, capability catalog,
  or desktop panel behavior.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: requiredness boundary split (phase 95)

Split required-question copy, required-slot computation, completeness
assessment, and missing-question lookup behind the existing
`packages/core/src/workflow/canvas/slots/requiredness.ts` facade. Preserve slot
ordering, labels, questions, filled-state rules, connector detection,
contract-issue handling, deployability, and public imports.

### Success criteria

- `slots/requiredness.ts` remains the stable public facade and is <= 40 lines.
- Focused modules under `slots/requiredness` have one clear responsibility and
  are <= 220 lines.
- Requiredness regression tests and Core typecheck remain green.
- The full project evaluator remains green.

### Non-goals

- Changing slot ordering, copy, filled-state rules, connector detection,
  contract validation, deployability, error behavior, or public import paths.
- Changing draft schemas, panel presentation, workflow compilation, or runtime
  execution.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: RDB config boundary split (phase 96)

Split RDB config contracts, config parsing/normalization, connection-string
validation, and connection probing behind the existing
`packages/core/src/modules/rdb/config.ts` facade. Preserve accepted database
types, normalized allowlists and row limits, validation error codes, secret
redaction, probe behavior, and public imports.

### Success criteria

- `modules/rdb/config.ts` remains the stable public facade and is <= 40 lines.
- Focused modules under `modules/rdb/config` have one clear responsibility and
  are <= 220 lines.
- RDB config/connector regression tests and Core typecheck remain green.
- The full project evaluator remains green.

### Non-goals

- Changing database type support, config normalization, URL validation,
  redaction, probe queries, error codes, connection lifecycle, or public import
  paths.
- Changing RDB client policy, table discovery, desktop connection handling, or
  runtime execution.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: AI evidence boundary split (phase 97)

Split AI evidence requirements/availability/policy checks from decision-output
validation and persistence behind the existing
`packages/core/src/runtime/investigation/evidence.ts` facade. Preserve binding
resolution, document/email evidence detection, cloud-policy decisions, output
validation errors, result mapping, diagnostics, and public imports.

### Success criteria

- `investigation/evidence.ts` remains the stable public facade and is <= 40
  lines.
- Focused modules under `investigation/evidence` have one clear responsibility
  and are <= 220 lines.
- AI investigation regression tests and Core typecheck remain green.
- The full project evaluator remains green.

### Non-goals

- Changing evidence requirements, binding precedence, cloud policy, output
  validation, diagnostics, result mapping, error codes/messages, or public
  import paths.
- Changing AI investigation orchestration, prompts, input extraction, or model
  execution.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: binding ports boundary split (phase 98)

Split output-port discovery, compatible-source selection, and action-parameter
value checks behind the existing
`packages/core/src/workflow/bindings/ports.ts` facade. Preserve output port
ordering and types, source-selection precedence and special cases, concrete
versus deferred value semantics, parameter aliases, and public imports.

### Success criteria

- `bindings/ports.ts` remains the stable public facade and is <= 40 lines.
- Focused modules under `bindings/ports` have one clear responsibility and are
  <= 220 lines.
- Binding, contract, and webhook mapping regression tests plus Core typecheck
  remain green.
- The full project evaluator remains green.

### Non-goals

- Changing output port discovery, source precedence, type compatibility,
  parameter aliases, deferred-value detection, or public import paths.
- Changing binding inference/application, contract validation, workflow schema,
  or runtime execution.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: source resolver boundary split (phase 99)

Split source connection contracts, connected-folder lookup, FileRef
resolution, and ingest-path resolution behind the existing
`packages/core/src/runtime/source-resolver.ts` facade. Preserve source
containment checks, symlink/path traversal protection, FileRef normalization,
error precedence, and public imports.

### Success criteria

- `runtime/source-resolver.ts` remains the stable public facade and is <= 40
  lines.
- Focused modules under `runtime/source-resolver` have one clear
  responsibility and are <= 220 lines.
- Source resolver, ingest-resolution, and local-folder security regressions plus
  Core typecheck remain green.
- The full project evaluator remains green.

### Non-goals

- Changing path containment, symlink handling, connected-folder selection,
  FileRef normalization, error precedence/codes, or public import paths.
- Changing document ingest mapping, local-folder configuration, or runtime
  execution.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: document read actions boundary split (phase 105)

Split document ingest, chunk read, page read, and document search handlers
behind the existing `packages/core/src/modules/document/read/actions.ts`
facade. Preserve parameter validation, engine calls, context variables, error
codes, and public imports.

### Success criteria

- `modules/document/read/actions.ts` remains the stable action facade and is <=
  40 lines.
- Focused modules under `modules/document/read/actions` have one clear
  responsibility and are <= 220 lines.
- Document engine/action regression and Core typecheck remain green.
- The full project evaluator remains green.

### Non-goals

- Changing document action parameter validation, engine behavior, context
  variables, error codes, or public import paths.
- Changing document-engine transport, document artifacts, workflow execution,
  or persistence.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: agent harness boundary split (phase 106)

Split agent run policy/data handling and model invocation orchestration behind
the existing `packages/core/src/agent/harness.ts` facade. Preserve provider
selection, timeout/abort behavior, cloud-data policy, vision validation,
structured output parsing, logs, errors, and public imports.

### Success criteria

- `agent/harness.ts` remains the stable public facade and is <= 100 lines.
- Focused modules under `agent/harness` have one clear responsibility and are
  <= 220 lines.
- Agent policy, command-chat, and investigation regressions plus Core
  typecheck remain green.
- The full project evaluator remains green.

### Non-goals

- Changing model provider selection, timeout/abort semantics, cloud redaction,
  vision checks, prompt composition, output parsing, logs, error codes, or
  public imports.
- Changing provider implementations, command handling, runtime investigation,
  or persistence.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: AI investigation runner boundary split (phase 107)

Move the AI decision execution state machine behind the existing
`packages/core/src/runtime/ai-investigation.ts` facade into the established
`runtime/investigation` boundary. Preserve read limits, evidence gathering,
cloud-data policy, prompt construction, final-output repair, persistence,
errors, and public imports.

### Success criteria

- `runtime/ai-investigation.ts` remains the stable public facade and is <= 40
  lines.
- The focused investigation runner module is <= 220 lines and has one clear
  responsibility.
- AI investigation, webhook prompt, manual parameter, and capability-read
  regressions plus Core typecheck remain green.
- The full project evaluator remains green.

### Non-goals

- Changing investigation read limits, evidence semantics, cloud policy,
  prompt text, persistence, output validation, error codes, or public imports.
- Changing connectors, workflow execution, agent providers, or persistence.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: workspace chat IPC boundary split (phase 108)

Split the workspace chat request handler, chat controls, and confirmation/id
helpers behind the existing Electron IPC facade
`apps/desktop/electron/main/ipc/workspace-chat-command-handlers.ts`.
Preserve IPC channel names, registration order, input validation, request
tracking, progress events, command callbacks, errors, and response shape.

### Success criteria

- `workspace-chat-command-handlers.ts` remains the stable registration facade
  and is <= 40 lines.
- Focused modules under `workspace-chat-command-handlers` have one clear
  responsibility and are <= 220 lines.
- Desktop typecheck/build and relevant Core command/chat regressions remain
  green.
- The full project evaluator remains green.

### Non-goals

- Changing IPC channel names, validation, request cancellation, progress
  events, command callbacks, response shape, error handling, or public imports.
- Changing preload APIs, renderer behavior, core command handling, or storage.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: work discovery pipeline boundary split (phase 109)

Move the work-discovery execution pipeline behind the existing
`packages/core/src/work-discovery/pipeline.ts` facade into a focused pipeline
runner module. Preserve checkpoint recovery, cancellation, source inventory,
snapshot persistence, candidate replay, clarification decisions, blueprint
creation, state transitions, budgets, and errors.

### Success criteria

- `work-discovery/pipeline.ts` remains the stable public facade and is <= 40
  lines.
- The focused pipeline runner module is <= 220 lines.
- Work-discovery service, repair, and end-to-end regressions plus Core
  typecheck remain green.
- The full project evaluator remains green.

### Non-goals

- Changing discovery state transitions, source reads, snapshots, replay
  semantics, clarification/blueprint decisions, budgets, persistence, errors,
  or public imports.
- Changing connectors, workflow compilation, UI behavior, or persistence
  schema.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: Gmail new-message polling boundary split (phase 110)

Split Gmail polling contracts, message metadata conversion, and history/cursor
polling behind the existing `packages/core/src/modules/gmail/new-message-poll.ts`
facade. Preserve initialization behavior, inbox filtering, deduplication,
history pagination, 404 recovery, cursor updates, event payloads, and public
imports.

### Success criteria

- `modules/gmail/new-message-poll.ts` remains the stable public facade and is
  <= 40 lines.
- Focused polling modules under `modules/gmail/new-message-poll` have one clear
  responsibility and are <= 220 lines.
- Gmail polling and connector regressions plus Core typecheck remain green.
- The full project evaluator remains green.

### Non-goals

- Changing Gmail API calls, initialization/cursor semantics, inbox filtering,
  deduplication, pagination, 404 recovery, event payloads, or public imports.
- Changing OAuth, connector lifecycle, trigger execution, or persistence.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: Slack new-message polling boundary split (phase 111)

Split Slack polling contracts, history pagination/message filtering, and event
mapping behind the existing `packages/core/src/modules/slack/new-message-poll.ts`
facade. Preserve channel resolution, cursor invalidation, pagination,
deduplication, initialization behavior, event ordering, payloads, and public
imports.

### Success criteria

- `modules/slack/new-message-poll.ts` remains the stable public facade and is
  <= 40 lines.
- Focused polling modules under `modules/slack/new-message-poll` have one clear
  responsibility and are <= 220 lines.
- Slack polling and connector regressions plus Core typecheck remain green.
- The full project evaluator remains green.

### Non-goals

- Changing Slack API calls, channel resolution, cursor invalidation,
  pagination, deduplication, initialization, event ordering/payloads, or public
  imports.
- Changing Slack authentication, connector lifecycle, trigger execution, or
  persistence.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: trigger poller boundary split (phase 112)

Split trigger polling policy, cursor persistence, per-workflow event processing,
and lifecycle orchestration behind the existing
`packages/core/src/runtime/trigger-engine/poll.ts` facade. Preserve polling
eligibility, cursor updates, receipt deduplication, trigger filters, execution
acceptance/error handling, lifecycle-generation cancellation, and public
imports.

### Success criteria

- `runtime/trigger-engine/poll.ts` remains the stable `TriggerPoller` facade and
  is <= 40 lines.
- Focused poll modules under `runtime/trigger-engine/poll` have one clear
  responsibility and are <= 220 lines.
- Trigger polling/lifecycle regressions plus Core typecheck remain green.
- The full project evaluator remains green.

### Non-goals

- Changing trigger eligibility, cursor/receipt semantics, filter behavior,
  execution acceptance/error handling, lifecycle cancellation, or public
  imports.
- Changing trigger handlers, push transport behavior, workflow execution, or
  persistence schema.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: job proposal boundary split (phase 113)

Split job-proposal input validation, HTTP/Slack target selection, and pending
draft construction behind the existing
`packages/core/src/agent/commands/job-registration/propose.ts` facade. Preserve
argument coercion, validation messages, connection selection, Slack discovery
fallbacks, workflow compilation/contract checks, pending-draft persistence, and
public imports.

### Success criteria

- `job-registration/propose.ts` remains the stable `proposeJob` facade and is
  <= 40 lines.
- Focused proposal modules under `job-registration/propose` have one clear
  responsibility and are <= 220 lines.
- Job-registration behavior plus Core typecheck remain green.
- The full project evaluator remains green.

### Non-goals

- Changing argument coercion, validation messages, target resolution or
  discovery behavior, workflow compilation/contract validation, pending state,
  presentation payloads, or public imports.
- Changing job commit behavior, command dispatch, connectors, or persistence
  schema.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: discovery IPC handler boundary split (phase 114)

Split discovery artifact import, discovery command registration, and E2E fixture
handling behind the existing
`apps/desktop/electron/main/ipc/discovery-handlers.ts` facade. Preserve IPC
channel names, payload normalization, fixture path safety checks, artifact
import behavior, command context, and response shapes.

### Success criteria

- `discovery-handlers.ts` remains the stable registration facade and is <= 40
  lines.
- Focused discovery IPC modules under `ipc/discovery-handlers` have one clear
  responsibility and are <= 220 lines.
- Desktop typecheck/build and the discovery renderer regression remain green.
- The full project evaluator remains green.

### Non-goals

- Changing IPC channel names, argument normalization, fixture-root safety,
  artifact formats, command context, response shapes, or E2E behavior.
- Changing discovery command semantics, core discovery logic, preload APIs, or
  persistence.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: desktop main lifecycle boundary split (phase 115)

Split Desktop main-process instance/process guards and shutdown handling,
ready-time initialization, and connector hydration behind the existing
`apps/desktop/electron/main/index.ts` entrypoint. Preserve startup ordering,
E2E behavior, connector fallback policy, AI migration, window/tray creation,
IPC registration, notification subscriptions, and shutdown cleanup.

### Success criteria

- `main/index.ts` remains the stable entrypoint and is <= 50 lines.
- Focused startup modules under `main/startup` have one clear responsibility
  and are <= 220 lines.
- Desktop typecheck/build remain green.
- The full project evaluator remains green.

### Non-goals

- Changing startup ordering, instance/process handling, connector hydration or
  fallback policy, AI migration, E2E behavior, IPC registration, or shutdown
  semantics.
- Changing renderer behavior, core initialization, connector implementations,
  or persistence.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: approval resume boundary split (phase 116)

Split approval lookup/state guards from snapshot restoration, approved-action
execution, and result finalization behind the existing
`packages/core/src/runtime/execution/approval.ts` facade. Preserve approval
status transitions, global-off behavior, claim semantics, snapshot/log failure
handling, action validation, pending continuation, output contracts, and
execution result payloads.

### Success criteria

- `execution/approval.ts` remains the stable public facade and is <= 40 lines.
- Focused approval modules under `execution/approval` have one clear
  responsibility and are <= 220 lines.
- Runtime engine approval regressions plus Core typecheck remain green.
- The full project evaluator remains green.

### Non-goals

- Changing approval status transitions, claim behavior, snapshot/log parsing,
  action execution, pending continuation, output contracts, result payloads, or
  public imports.
- Changing normal workflow execution, connector behavior, persistence schema,
  or UI approval presentation.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: work-discovery lifecycle boundary split (phase 117)

Split work-discovery state operations from pipeline runner scheduling and
automatic recovery behind the existing
`packages/core/src/work-discovery/service/lifecycle.ts` factory. Preserve state
transitions, recovery checkpoints, cancellation checks, artifact observation,
pipeline inputs, scheduling, automatic-recovery limits, and runtime exports.

### Success criteria

- `service/lifecycle.ts` remains the stable runtime factory and is <= 40 lines.
- Focused lifecycle modules under `service/lifecycle` have one clear
  responsibility and are <= 220 lines.
- Work-discovery service and end-to-end regressions plus Core typecheck remain
  green.
- The full project evaluator remains green.

### Non-goals

- Changing discovery state transitions, checkpoints, cancellation, artifact
  observation, pipeline inputs, scheduling, recovery limits, or public exports.
- Changing discovery commands, pipeline semantics, persistence schema, or
  source connectors.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: desktop HTTP connection boundary split (phase 118)

Split HTTP credential storage, authentication construction, probe messaging,
connector application, and connect/disconnect/hydration operations behind the
existing `apps/desktop/electron/main/http/connection.ts` facade. Preserve OS
secret names and formats, endpoint selection, URL normalization, auth fallback,
probe behavior, connector state, and public imports.

### Success criteria

- `http/connection.ts` remains the stable public facade and is <= 40 lines.
- Focused HTTP connection modules under `main/http/connection` have one clear
  responsibility and are <= 220 lines.
- Desktop typecheck/build remain green.
- The full project evaluator remains green.

### Non-goals

- Changing credential storage, endpoint serialization, endpoint selection, URL
  security, auth validation, probe behavior, connector state, or public imports.
- Changing renderer settings, IPC payload validation, core HTTP modules, or
  persistence.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: desktop RDB connection boundary split (phase 119)

Split RDB secret storage, persisted metadata/config resolution, probe messaging,
hydration, and connect/disconnect operations behind the existing
`apps/desktop/electron/main/rdb/connection.ts` facade. Preserve secret names,
legacy metadata migration, database-type validation, probe behavior, connector
state, and public imports.

### Success criteria

- `rdb/connection.ts` remains the stable public facade and is <= 40 lines.
- Focused RDB connection modules under `main/rdb/connection` have one clear
  responsibility and are <= 220 lines.
- Desktop typecheck/build and Core RDB config/connector regressions remain green.
- The full project evaluator remains green.

### Non-goals

- Changing secret storage, metadata serialization, config resolution, legacy
  migration, database validation, probe behavior, connector state, or public
  imports.
- Changing IPC payload validation, Core RDB modules, or persistence schema.
- Refactoring unrelated modules or existing dirty worktree changes.

## Current structural task: desktop runtime IPC boundary split (phase 126)

Split approval, execution cleanup, and workflow activation handlers behind the
existing `apps/desktop/electron/main/ipc/runtime-handlers.ts` registration
facade. Preserve IPC channel names, input validation, approval claim and
rejection transitions, execution result/log semantics, runtime notifications,
error messages, and public imports.

### Success criteria

- `runtime-handlers.ts` remains the stable registration facade and is <= 40
  lines.
- Focused runtime handler modules under `ipc/runtime-handlers` have one clear
  responsibility and are <= 220 lines.
- Desktop typecheck/build and Core runtime regressions remain green.
- The full project evaluator remains green.

### Non-goals

- Changing approval status transitions, rejection logging, runtime execution,
  workflow activation behavior, validation, error messages, or IPC channels.
- Changing renderer APIs, Core runtime/persistence, or public imports.
- Refactoring unrelated modules or existing dirty worktree changes.
-
## Current structural task: runtime engine approval-test boundary split (phase 148)

Split approval continuation, corrupt approval state, and approval action
validation scenarios from `packages/core/src/runtime/engine.test.ts` into a
focused test module. Preserve every test case, assertion, fixture, and runtime
behavior; this is a test-organization-only change.

### Success criteria

- `runtime/engine.test.ts` remains focused on general execution/control-flow
  coverage and is <= 950 lines.
- `runtime/engine/approval-resume.test.ts` contains the extracted approval
  continuation coverage and is <= 520 lines.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing production runtime code, approval semantics, persistence, fixtures,
  test assertions, test data, or public imports.
- Refactoring unrelated tests or existing dirty worktree changes.

## Current structural task: work discovery service test boundary split (phase 155)

Split the mixed lifecycle and checkpoint-recovery scenarios in
`packages/core/src/work-discovery/service.test.ts` into focused lifecycle and
recovery test modules. Move the shared `makeSession` fixture into a test-only
fixture module. Preserve every test body, fixture value, assertion, and
recovery behavior; this is a test-organization-only change.

### Success criteria

- `work-discovery/service.test.ts` remains focused on the service lifecycle
  and is <= 180 lines.
- `work-discovery/service/lifecycle.test.ts` contains lifecycle/conflict
  coverage and is <= 180 lines.
- `work-discovery/service/recovery.test.ts` contains checkpoint and recovery
  coverage and is <= 320 lines.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing discovery lifecycle, checkpoint recovery, retry semantics, source
  reads, persistence, fixtures, test assertions, test data, or production
  imports.
- Refactoring unrelated tests or existing dirty worktree changes.

## Current structural task: job registration test domain split (phase 156)

Split the mixed scheduled-job compiler, target selection, proposal input
normalization, commit/security, and command-visibility scenarios in
`packages/core/src/agent/commands/job-registration.test.ts` into focused test
modules. Move shared proposal arguments and connected-service setup into a
test-only fixture module. Preserve every test body, fixture value, assertion,
and job-registration behavior; this is a test-organization-only change.

### Success criteria

- `agent/commands/job-registration.test.ts` remains focused on scheduled job
  compilation and is <= 100 lines.
- `agent/commands/job-registration/targets.test.ts` contains target-selection
  and discovery fallback coverage and is <= 230 lines.
- `agent/commands/job-registration/input-validation.test.ts` contains
  proposal normalization and validation coverage and is <= 240 lines.
- `agent/commands/job-registration/commit.test.ts` contains commit and
  fail-closed execution coverage and is <= 180 lines.
- `agent/commands/job-registration/access.test.ts` contains command boundary
  and connection-binding coverage and is <= 140 lines.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing job proposal/commit behavior, target discovery, input normalization,
  connection binding, command visibility, fixtures, test assertions, test
  data, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

## Current structural task: chat command flow test domain split (phase 157)

Split the mixed command-loop, HTTP/Slack target-selection, connection
selection, session-context, and recurring-job registration scenarios in
`packages/core/src/agent/commands/chat.test.ts` into focused test modules.
Move the shared scripted model helper into a test-only fixture module.
Preserve every test body, fixture value, assertion, and chat behavior; this is
a test-organization-only change.

### Success criteria

- `agent/commands/chat.test.ts` remains focused on the command loop and is <=
  220 lines.
- `agent/commands/chat/target-selection.test.ts` contains HTTP/Slack target
  card coverage and is <= 220 lines.
- `agent/commands/chat/connection-selection.test.ts` contains connection
  chooser coverage and is <= 220 lines.
- `agent/commands/chat/context.test.ts` contains bounded context coverage and
  is <= 180 lines.
- `agent/commands/chat/job-registration.test.ts` contains recurring job
  registration coverage and is <= 180 lines.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing chat command-loop behavior, presentations, target/connection
  selection, context persistence, job registration, fixtures, test
  assertions, test data, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

## Current structural task: scheduler test boundary split (phase 158)

Split the one-time job lifecycle scenarios from the scheduled-job retry,
corruption, exception-isolation, and recovery scenarios in
`packages/core/src/runtime/scheduler.test.ts`. Keep one-time coverage in the
existing file and move scheduled coverage to a focused test module. Preserve
every test body, fixture value, assertion, timer behavior, and scheduler
semantics; this is a test-organization-only change.

### Success criteria

- `runtime/scheduler.test.ts` remains focused on one-time job behavior and is
  <= 210 lines.
- `runtime/scheduler/scheduled.test.ts` contains scheduled retry and recovery
  coverage and is <= 220 lines.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing scheduler timing, one-time consumption, retry semantics, persisted
  state handling, exception isolation, fixtures, test assertions, test data,
  or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Final (2026-09-03T10:08:02.9267955+09:00)

- `runtime/scheduler.test.ts` is 162 lines and remains focused on one-time
  job behavior; `runtime/scheduler/scheduled.test.ts` is 182 lines and holds
  scheduled retry, corruption, exception-isolation, and recovery coverage.
- Test names, fixtures, assertions, timer cleanup, and scheduler behavior were
  preserved; focused scheduler tests pass 8/8.
- Core typecheck/tests/evaluation, document-engine tests, desktop
  typecheck/build, architecture check, and `git diff --check` all pass.

## Current validation task: Work Discovery Benchmark v1 test lab

Create a reproducible, production-shaped benchmark for the implemented Work
Discovery synthesis boundary. Keep benchmark code and contracts in the
repository, while keeping generated fixtures, external-like inputs, run
artifacts, and logs under `D:\\ax\\_test`. Measure the value of replay and
clarification without adding real provider side effects or hardcoded answers.

### Success criteria

- A documented benchmark contract defines examples, holdout cases, expected
  outcomes, accepted equivalent transformations, and metric denominators.
- A deterministic fixture generator creates varied, inspectable cases under
  an explicit benchmark root without using real credentials or external APIs.
- The original 10-case golden set remains stable while a rotating profile adds
  deterministic seed and structural mutations so the runner is not tuned to
  fixed values or case IDs.
- The runner evaluates AX Full, AX without replay, and AX without
  clarification on the same cases and writes machine-readable plus human-
  readable reports outside the repository.
- The benchmark includes correct publish, correct clarification, correct
  no-match, source ambiguity, holdout-overfit, null/duplicate, and truncated
  snapshot cases.
- The runner proves replay never performs external side effects and never
  treats a failed or ambiguous case as publishable.
- Existing Core tests, evaluation, desktop typecheck/build, document-engine,
  architecture, and whitespace checks remain green.

### Non-goals

- Replacing existing unit, integration, Electron E2E, or product QA suites.
- Calling real Gmail, Slack, HTTP, PostgreSQL, or AI provider services from
  the benchmark.
- Using `D:\\ax\\_test\\acceptance\\테스트양식.pdf` as an implementation
  oracle; it remains a final black-box acceptance input only.
- Expanding Work Discovery to unsupported text/document synthesis in this
  validation slice.

### Final verification for this iteration (2026-09-04T09:53:53.7883819+09:00)

- The fixed v1 profile runs 10 cases; the rotating profile runs 14 cases with
  four explicit structural mutations. Both are generated outside the repo.
- Full v1 and rotating runs achieved 100% correct publish, 0% false publish,
  and 100% safe decision; ambiguity remained clarification and no-match cases
  remained blocked. Ablations exposed replay and clarification regressions.
- Same-seed regeneration produced zero mismatches across 98 case/expected
  files; a different seed changed fixture values while preserving outcomes.
- Core typecheck, 331 Core test files (717 passed, 3 skipped), evaluation 11/11,
  desktop typecheck/build, document-engine 39/39, architecture, and diff
  checks passed. No production implementation was changed.

## Current validation task: Work Discovery adversarial profile expansion

Keep the v1 golden and rotating profiles unchanged while adding independent
benchmark profiles for schema drift, source confusion, holdout overfit, and
input-format variation. Each profile must use independently declared gold
outcomes, run the same ablations, preserve the no-side-effect boundary, and
write explicit failure evidence rather than changing expected results to fit
the current implementation.

### Success criteria

- `schema-drift`, `source-confusion`, `holdout`, `input-variation`, and
  combined `expanded` profiles have validated case counts and stable IDs.
- Gold case construction does not import or call Core candidate enumeration,
  replay, or transform evaluation; expected values remain independently
  derived from fixture data.
- CSV, XLSX, PostgreSQL, and PDF input artifacts are generated under the
  external test lab without live connector calls or credentials.
- Full, no-replay, and no-clarification results are reported for every new
  profile, with seed/profile metadata and a separate failure report.
- Holdout-only failures are visible as evidence and are not silently reclassified
  as passing cases.
- Existing v1/rotating benchmark results and all project regression checks stay
  green; no production behavior is changed.

### Non-goals

- Patching production Work Discovery behavior in response to a newly exposed
  benchmark failure during this iteration.
- Calling real PostgreSQL, XLSX providers, Docling, PDF services, Slack, HTTP,
  or other external connectors from the benchmark.
- Using `D:\\ax\\_test\\acceptance\\테스트양식.pdf` as a gold oracle.

### Baseline (2026-09-04T09:54:55.068+09:00)

- v1 and rotating profiles existed and passed their contracts and safety run;
  expansion profiles and `latest-failures.*` artifacts did not exist.
- The previous rotating run had 14 cases with Full correct publish 100%, false
  publish 0%, and safe decision 100%.
- Core typecheck/tests/evaluation, Desktop build, document-engine, architecture,
  and whitespace checks were green.

### Final verification (2026-09-04T10:07:21.5999519+09:00)

- All five new profile contracts passed: schema-drift/source-confusion/
  holdout/input-variation each 14 cases; expanded 30 cases.
- Schema-drift, source-confusion, and input-variation Full runs had 100%
  correct publish, 0% false publish, and 100% safe decision.
- Holdout and expanded runs recorded three Full holdout-generalization
  failures (B24-B26) in separate failure reports; these were not reclassified
  or hidden. They are the next production investigation target.
- Same-seed reproducibility, raw CSV/XLSX/SQL/PDF generation, Core and project
  regression checks passed. Production code remained unchanged.

## Current structural task: workflow repair test split (phase 208)

Split `workflow/repair.test.ts` into focused repair-candidate suggestion and
candidate-application test modules, extracting their shared workflow/table
fixtures into a dedicated fixture module. Preserve every test body, fixture
data, repair operation, policy assertion, fingerprint assertion, and repair
behavior; this is a test-organization-only change.

### Success criteria

- `workflow/repair/fixtures.ts` contains the shared contract/table/workflow
  fixture data and is <= 100 lines.
- `workflow/repair/candidate-suggestions.test.ts` contains compatible and
  incompatible candidate suggestion scenarios and is <= 55 lines.
- `workflow/repair/candidate-application.test.ts` contains selected mapping
  application/policy preservation and is <= 45 lines.
- The previous mixed `workflow/repair.test.ts` is absent; all three existing
  scenario blocks remain covered exactly once. Core typecheck/tests/evaluation
  and the full project evaluator remain green.

### Non-goals

- Changing repair candidate suggestion, type compatibility, row-value safety,
  selected mapping application, policy/side-effect preservation, fingerprint
  protection, fixtures, assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T16:11:27.4149882+09:00)

- `workflow/repair.test.ts` is 151 lines and combines three repair candidate
  scenarios with shared contract/table/workflow fixtures; the focused repair
  test directory is absent.
- The existing workflow repair suite passes 3/3. Core typecheck/tests,
  evaluation, document-engine 39/39, desktop typecheck/build, architecture,
  and whitespace checks pass.

### Focused verification (2026-09-03T16:13:01.5792390+09:00)

- The mixed original suite is absent. `fixtures.ts` is 86 lines,
  `candidate-suggestions.test.ts` is 33 lines, and
  `candidate-application.test.ts` is 35 lines.
- The focused workflow repair suites pass all three scenarios (3/3).

### Focused correction (2026-09-03T16:14:37.9411254+09:00)

- The shared fixture explicitly includes the schema-defaulted `truncated: false`
  field and is now 87 lines; the two focused test modules remain 33 and 35
  lines.
- The focused workflow repair suites still pass all three scenarios (3/3).

### Final verification (2026-09-03T16:16:42.9309861+09:00)

- Core typecheck passed; 232 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (986 modules, 3305 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes; the explicit
  `truncated: false` field only makes the existing schema default type-safe in
  the extracted fixture module.

## Current structural task: canvas slot test split (phase 248)

Split `workflow/canvas/test/slots/slots.test.ts` into ID/filled-state,
required-slot, bound-parameter, and Gmail-body test modules. Preserve every
slot id, action node, question text, bound output, connector, required field,
and assertion; this is a test-organization-only change.

### Success criteria

- `workflow/canvas/test/slots/ids-and-filled.test.ts` contains slot ID and
  filled-state coverage and is <= 30 lines.
- `workflow/canvas/test/slots/required-slots.test.ts` contains per-action
  required-slot coverage and is <= 45 lines.
- `workflow/canvas/test/slots/bound-params.test.ts` contains bound text
  requiredness coverage and is <= 45 lines.
- `workflow/canvas/test/slots/gmail-body.test.ts` contains Gmail body
  deployability coverage and is <= 40 lines.
- The previous mixed `workflow/canvas/test/slots/slots.test.ts` is absent; all
  five existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing slot ID parsing, filled-state rules, requiredness assessment,
  generated questions, connector requirements, fixtures, assertions, or
  production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T20:05:05.4493897+09:00)

- `workflow/canvas/test/slots/slots.test.ts` is 114 lines and combines five
  slot/requiredness scenarios; the focused slot modules are absent.
- The existing slots suite passes 5/5. The latest full project regression
  passes: Core 303 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused verification (2026-09-03T20:06:32.0700239+09:00)

- All four focused canvas slot suites pass 5/5.
- `ids-and-filled.test.ts` is 15 lines, `required-slots.test.ts` is 20 lines,
  `bound-params.test.ts` is 16 lines, and `gmail-body.test.ts` is 14 lines;
  the mixed root suite is absent.

### Final verification (2026-09-03T20:08:23.5147265+09:00)

- The four focused canvas slot suites remain green at 5/5.
- Core tests passed with 306 files, 717 passed, and 3 skipped; core eval
  passed 11/11; document-engine passed 39/39; desktop typecheck/build,
  architecture (1065 modules, 3512 dependencies), and `git diff --check`
  passed.
- No production code changed; the mixed slot suite was split into identity,
  requiredness, bound-parameter, and connector-specific modules.

## Current structural task: workflow contract validator test split (phase 247)

Split `workflow/contract-validator.test.ts` into contract-compatibility,
contract-mappers, and workflow-validation test modules. Preserve every contract
type, mapper input/output, WorkflowIR trigger, ingest step, invalid trigger
case, timezone, issue code/message, and assertion; this is a test-organization-
only change.

### Success criteria

- `workflow/contract-validator/contract-compatibility.test.ts` contains the two
  compatibility scenarios and is <= 25 lines.
- `workflow/contract-validator/contract-mappers.test.ts` contains the two
  mapper scenarios and is <= 35 lines.
- `workflow/contract-validator/workflow-validation.test.ts` contains the five
  workflow validation scenarios and is <= 65 lines.
- The previous mixed `workflow/contract-validator.test.ts` is absent; all nine
  existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing contract compatibility, mapper behavior, WorkflowIR validation,
  trigger requiredness, schedule validation, issue codes/messages, fixtures,
  assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T20:00:42.1363811+09:00)

- `workflow/contract-validator.test.ts` is 107 lines and combines nine
  compatibility, mapping, and workflow validation scenarios; the focused
  validator modules are absent.
- The existing contract-validator suite passes 9/9. The latest full project
  regression passes: Core 301 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused verification (2026-09-03T20:02:05.7110621+09:00)

- All three focused workflow contract-validator suites pass 9/9.
- `contract-compatibility.test.ts` is 11 lines, `contract-mappers.test.ts`
  is 14 lines, and `workflow-validation.test.ts` is 35 lines; the mixed root
  suite is absent.

### Final verification (2026-09-03T20:03:53.7128873+09:00)

- The three focused workflow contract-validator suites remain green at 9/9.
- Core tests passed with 303 files, 717 passed, and 3 skipped; core eval
  passed 11/11; document-engine passed 39/39; desktop typecheck/build,
  architecture (1062 modules, 3510 dependencies), and `git diff --check`
  passed.
- No production code changed; the mixed contract-validator suite was split
  into compatibility, mapper, and workflow-validation modules.

## Current structural task: North Star chat safety test boundary split (phase 271)

Split `north-star/north-star-qa/chat-safety.test.ts` along its existing QA
sections into plain-chat knowledge/action safety and cloud untrusted-evidence
redaction tests. Preserve every connector context, source policy, capability
call, redaction assertion, snippet cap, cleanup, and cloud-provider observation;
this is a test-organization-only change.

### Success criteria

- `north-star/north-star-qa/plain-chat-safety.test.ts` contains the four
  existing plain-chat Slack/PDF/search scenarios and is <= 100 lines.
- `north-star/north-star-qa/cloud-evidence-safety.test.ts` contains the
  untrusted source body redaction scenario and is <= 45 lines.
- The previous mixed `north-star/north-star-qa/chat-safety.test.ts` is absent;
  all five existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing North Star QA behavior, connector contexts, capability invocation,
  local-data policy, snippet limits, cloud redaction, cleanup, assertions, or
  production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T21:57:35.3042578+09:00)

- `north-star/north-star-qa/chat-safety.test.ts` is 111 lines and already
  contains two distinct QA sections: four plain-chat scenarios and one cloud
  untrusted-evidence scenario; focused modules are absent.
- The existing chat safety suite passes 5/5. The latest full project
  regression passes: Core 330 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused (2026-09-03T21:59:17.3117297+09:00)

- `north-star/north-star-qa/plain-chat-safety.test.ts` is 86 lines and
  `north-star/north-star-qa/cloud-evidence-safety.test.ts` is 35 lines; the
  previous mixed suite is absent.
- All five North Star chat safety scenarios pass 5/5 after the split.

### Final (2026-09-03T22:01:05.3675489+09:00)

- The North Star chat safety tests were split along their existing plain-chat
  and cloud untrusted-evidence QA sections without changing production code or
  scenario behavior.
- Focused tests pass 5/5. The full project evaluator passes: Core 331 test
  files with 717 passed and 3 skipped, evaluation 11/11, document-engine
  39/39, desktop typecheck/build, architecture (1092 modules, 3583
  dependencies), and whitespace checks.

## Current structural task: approval continuation guard test boundary split (phase 270)

Split `runtime/engine/approval/continuation/guards.test.ts` into the global
execution-off guard and the branch approval-bypass guard. Preserve every
workflow IR, approval state, side-effect level, branch input, continuation
result, error code, sent-message assertion, and sent-mail assertion; this is a
test-organization-only change.

### Success criteria

- `runtime/engine/approval/continuation/global-off.test.ts` contains the
  global execution-off continuation guard and is <= 70 lines.
- `runtime/engine/approval/continuation/branch-bypass.test.ts` contains the
  branch approval-bypass guard and is <= 70 lines.
- The previous mixed `runtime/engine/approval/continuation/guards.test.ts` is
  absent; both existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing approval continuation, global execution state, branch traversal,
  side-effect gating, error codes, sent messages/mail, workflow IR,
  assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T21:53:21.3179696+09:00)

- `runtime/engine/approval/continuation/guards.test.ts` is 100 lines and
  combines the global execution-off gate with branch approval-bypass
  protection; focused modules are absent.
- The existing approval guard suite passes 2/2. The latest full project
  regression passes: Core 329 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused (2026-09-03T21:54:55.1231526+09:00)

- `runtime/engine/approval/continuation/global-off.test.ts` is 50 lines and
  `runtime/engine/approval/continuation/branch-bypass.test.ts` is 58 lines;
  the previous mixed suite is absent.
- Both approval continuation guard scenarios pass 2/2 after the split.

### Final (2026-09-03T21:56:49.4868281+09:00)

- The approval continuation guard tests were split by global execution-off
  blocking and branch approval-bypass protection without changing production
  code or scenario behavior.
- Focused tests pass 2/2. The full project evaluator passes: Core 330 test
  files with 717 passed and 3 skipped, evaluation 11/11, document-engine
  39/39, desktop typecheck/build, architecture (1091 modules, 3581
  dependencies), and whitespace checks.

## Current structural task: discovery session test boundary split (phase 269)

Split `store/discovery-repository/session.test.ts` into valid session
round-trip persistence and malformed/session-schema validation tests. Preserve
every on-disk database reopen, session state, example row, malformed payload,
error code/session ID, and list/get fail-closed assertion; this is a
test-organization-only change.

### Success criteria

- `store/discovery-repository/session-roundtrip.test.ts` contains valid
  session/example persistence across database reopen and is <= 75 lines.
- `store/discovery-repository/session-validation.test.ts` contains malformed
  JSON and invalid-schema coverage and is <= 75 lines.
- The previous mixed `store/discovery-repository/session.test.ts` is absent;
  all three existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing discovery session serialization, database reopen behavior, example
  persistence, malformed JSON handling, schema validation, error metadata,
  fail-closed behavior, assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T21:48:17.3457100+09:00)

- `store/discovery-repository/session.test.ts` is 97 lines and combines valid
  session round-trip persistence with malformed/schema-invalid storage;
  focused modules are absent.
- The existing discovery session suite passes 3/3. The latest full project
  regression passes: Core 328 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused (2026-09-03T21:49:45.0959679+09:00)

- `store/discovery-repository/session-roundtrip.test.ts` is 55 lines and
  `store/discovery-repository/session-validation.test.ts` is 49 lines; the
  previous mixed suite is absent.
- All three discovery session scenarios pass 3/3 after the split.

### Final (2026-09-03T21:51:33.8465828+09:00)

- The discovery session tests were split by valid round-trip persistence and
  malformed/schema-invalid validation without changing production code or
  scenario behavior.
- Focused tests pass 3/3. The full project evaluator passes: Core 329 test
  files with 717 passed and 3 skipped, evaluation 11/11, document-engine
  39/39, desktop typecheck/build, architecture (1090 modules, 3576
  dependencies), and whitespace checks.

## Current structural task: execution progress observer test boundary split (phase 268)

Split `runtime/engine/execution-observability/progress-observers.test.ts`
into progress event/log persistence and observer-failure isolation tests.
Preserve every progress event, persisted log code, observer callback failure,
execution result, and persisted success assertion; this is a
test-organization-only change.

### Success criteria

- `runtime/engine/execution-observability/progress-events.test.ts` contains
  progress reporting and persisted step-log coverage and is <= 70 lines.
- `runtime/engine/execution-observability/observer-isolation.test.ts` contains
  observer failure isolation coverage and is <= 70 lines.
- The previous mixed `runtime/engine/execution-observability/progress-observers.test.ts`
  is absent; both existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing WorkflowRuntime progress callbacks, persisted execution logs,
  observer exception handling, execution outcomes, connector behavior,
  workflow fixtures, assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T21:44:27.2664980+09:00)

- `runtime/engine/execution-observability/progress-observers.test.ts` is 97
  lines and combines progress/log reporting with observer-failure isolation;
  focused modules are absent.
- The existing progress observer suite passes 2/2. The latest full project
  regression passes: Core 327 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused (2026-09-03T21:45:57.1427955+09:00)

- `runtime/engine/execution-observability/progress-events.test.ts` is 55 lines
  and `runtime/engine/execution-observability/observer-isolation.test.ts` is
  49 lines; the previous mixed suite is absent.
- Both progress observer scenarios pass 2/2 after the split.

### Final (2026-09-03T21:47:47.7024146+09:00)

- The progress observer tests were split by progress/log persistence and
  observer-failure isolation without changing production code or scenario
  behavior.
- Focused tests pass 2/2. The full project evaluator passes: Core 328 test
  files with 717 passed and 3 skipped, evaluation 11/11, document-engine
  39/39, desktop typecheck/build, architecture (1089 modules, 3574
  dependencies), and whitespace checks.

## Current structural task: polling initialization test boundary split (phase 267)

Split `runtime/trigger-engine/poll/initialization.test.ts` into first-poll
baseline behavior and corrupted-cursor recovery tests. Preserve every existing
message, workflow, cursor shape, `it.each` input, initialization flag,
seen-message list, notification assertion, and valid-cursor preservation rule;
this is a test-organization-only change.

### Success criteria

- `runtime/trigger-engine/poll/baseline.test.ts` contains first-poll baseline
  and new-message once-only coverage and is <= 75 lines.
- `runtime/trigger-engine/poll/cursor-recovery.test.ts` contains both
  corrupted-store cases and malformed workflow cursor preservation and is <=
  75 lines.
- The previous mixed `runtime/trigger-engine/poll/initialization.test.ts` is
  absent; all four generated scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing TriggerEngine initialization, cursor parsing/rebuilding,
  notification behavior, valid-cursor preservation, fixture data, assertions,
  or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T21:40:13.0594587+09:00)

- `runtime/trigger-engine/poll/initialization.test.ts` is 99 lines and
  combines first-poll baseline behavior with global/workflow cursor recovery;
  focused modules are absent.
- The existing polling initialization suite passes 4/4 generated scenarios.
  The latest full project regression passes: Core 326 files with 717 passed
  and 3 skipped, eval 11/11, document-engine 39/39, desktop typecheck/build,
  architecture, and whitespace checks.

### Focused (2026-09-03T21:41:49.3826234+09:00)

- `runtime/trigger-engine/poll/baseline.test.ts` is 43 lines and
  `runtime/trigger-engine/poll/cursor-recovery.test.ts` is 64 lines; the
  previous mixed suite is absent.
- All four generated polling initialization scenarios pass 4/4 after the
  split.

### Final (2026-09-03T21:43:37.9052747+09:00)

- The polling initialization tests were split by first-poll baseline behavior
  and corrupted-cursor recovery without changing production code or scenario
  behavior.
- Focused tests pass 4/4 generated scenarios. The full project evaluator
  passes: Core 327 test files with 717 passed and 3 skipped, evaluation 11/11,
  document-engine 39/39, desktop typecheck/build, architecture (1088 modules,
  3570 dependencies), and whitespace checks.

## Current structural task: execution context test boundary split (phase 266)

Split `runtime/engine/execution-lifecycle/contexts.test.ts` into artifact-sink
context injection and live connector registry tests. Preserve every runtime
fixture, fresh/approval-resumed execution, observed sink, connector replacement
and removal assertion, and execution result; this is a test-organization-only
change.

### Success criteria

- `runtime/engine/execution-lifecycle/artifact-sink.test.ts` contains the
  fresh/approval-resumed artifact sink scenario and is <= 75 lines.
- `runtime/engine/execution-lifecycle/connector-lifecycle.test.ts` contains
  live connector replacement/removal coverage and is <= 45 lines.
- The previous mixed `runtime/engine/execution-lifecycle/contexts.test.ts` is
  absent; both existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing WorkflowRuntime context creation, approval continuation, artifact
  sink ownership, connector registration, replacement/removal behavior,
  workflow steps, assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T21:38:15.2320554+09:00)

- `runtime/engine/execution-lifecycle/contexts.test.ts` is 103 lines and
  combines artifact-sink context injection with live connector registry
  behavior; focused modules are absent.
- The existing execution contexts suite passes 2/2. The latest full project
  regression passes: Core 326 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Final decision (2026-09-03T21:39:31.7901001+09:00)

- DISCARD: the artifact-sink scenario is itself one cohesive, long workflow
  context test. Splitting it from the short connector registry scenario would
  leave an imbalanced file and would not create a useful responsibility
  boundary.
- No test or production files were changed for this candidate.

## Current structural task: polling execution checkpoint test boundary split (phase 265)

Split `runtime/trigger-engine/poll/execution.test.ts` into failed-execution
cursor handling and stop-during-execution checkpoint tests. Preserve every
connector override, message event, cursor assertion, receipt status, in-flight
promise, stop ordering, notification, and once-only assertion; this is a
test-organization-only change.

### Success criteria

- `runtime/trigger-engine/poll/failure-checkpoint.test.ts` contains the
  failed-execution cursor scenario and is <= 75 lines.
- `runtime/trigger-engine/poll/stop-checkpoint.test.ts` contains the
  in-flight stop/success checkpoint scenario and is <= 75 lines.
- The previous mixed `runtime/trigger-engine/poll/execution.test.ts` is absent;
  both existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing TriggerEngine polling, cursor advancement, failure handling,
  shutdown ordering, trigger receipts, connector behavior, fixtures,
  assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T21:33:18.6763788+09:00)

- `runtime/trigger-engine/poll/execution.test.ts` is 107 lines and combines
  failed-execution cursor handling with stop-during-execution checkpointing;
  focused modules are absent.
- The existing polling execution suite passes 2/2. The latest full project
  regression passes: Core 325 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused (2026-09-03T21:35:09.4402662+09:00)

- `runtime/trigger-engine/poll/failure-checkpoint.test.ts` is 52 lines and
  `runtime/trigger-engine/poll/stop-checkpoint.test.ts` is 63 lines; the
  previous mixed suite is absent.
- Both polling checkpoint scenarios pass 2/2 after the split.

### Final (2026-09-03T21:37:16.7653517+09:00)

- The polling execution checkpoint tests were split by failed-execution cursor
  handling and stop-during-execution checkpointing without changing production
  code or scenario behavior.
- Focused tests pass 2/2. The full project evaluator passes: Core 326 test
  files with 717 passed and 3 skipped, evaluation 11/11, document-engine
  39/39, desktop typecheck/build, architecture (1087 modules, 3564
  dependencies), and whitespace checks.

## Current structural task: workspace chat transcript test boundary split (phase 264)

Split `store/workspace-chat-repository/transcript.test.ts` into transcript
input-integrity and valid transcript persistence tests. Preserve every invalid
message, corrupt-row fixture, database row, workflow mapping, memo update,
presentation payload, reload assertion, and fail-closed behavior; this is a
test-organization-only change.

### Success criteria

- `store/workspace-chat-repository/transcript-validation.test.ts` contains the
  message validation and corrupt-row scenarios and is <= 75 lines.
- `store/workspace-chat-repository/transcript-persistence.test.ts` contains
  valid chat, memo, and presentation round-trip scenarios and is <= 75 lines.
- The previous mixed `store/workspace-chat-repository/transcript.test.ts` is
  absent; all five existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing workspace chat validation, corrupt-row handling, transcript
  persistence, memo isolation, presentation metadata, workflow mapping,
  database schema, assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T21:28:34.9197693+09:00)

- `store/workspace-chat-repository/transcript.test.ts` is 91 lines and
  combines input-integrity scenarios with valid transcript persistence;
  focused modules are absent.
- The existing transcript suite passes 5/5. The latest full project
  regression passes: Core 324 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused (2026-09-03T21:30:07.9881975+09:00)

- `store/workspace-chat-repository/transcript-validation.test.ts` is 30 lines
  and `store/workspace-chat-repository/transcript-persistence.test.ts` is 66
  lines; the previous mixed suite is absent.
- All five transcript scenarios pass 5/5 after the split.

### Final (2026-09-03T21:31:59.2453565+09:00)

- The workspace chat transcript tests were split by input integrity and valid
  transcript persistence without changing production code or scenario
  behavior.
- Focused tests pass 5/5. The full project evaluator passes: Core 325 test
  files with 717 passed and 3 skipped, evaluation 11/11, document-engine
  39/39, desktop typecheck/build, architecture (1086 modules, 3558
  dependencies), and whitespace checks.

## Current structural task: Slack Socket Mode test boundary split (phase 263)

Split `triggers/slack/new-message/socket-mode.test.ts` into Slack socket error
formatting and listener lifecycle tests. Preserve every SDK error shape, token
and URL redaction assertion, client event, timeout guard, state update, logger
call, cleanup, and disconnect assertion; this is a test-organization-only
change.

### Success criteria

- `triggers/slack/new-message/error-formatting.test.ts` contains all five
  `formatSlackSocketError` scenarios and is <= 75 lines.
- `triggers/slack/new-message/listener-lifecycle.test.ts` contains the
  listener non-blocking/reconnect lifecycle scenario and is <= 75 lines.
- The previous mixed `triggers/slack/new-message/socket-mode.test.ts` is
  absent; all six existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing Slack error formatting, redaction, Socket Mode listener lifecycle,
  reconnect behavior, state reporting, logging, cleanup, assertions, or
  production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T21:23:18.5566096+09:00)

- `triggers/slack/new-message/socket-mode.test.ts` is 105 lines and combines
  five error-formatting scenarios with one listener lifecycle scenario; the
  focused modules are absent.
- The existing Socket Mode suite passes 6/6. The latest full project
  regression passes: Core 323 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused (2026-09-03T21:25:13.9985686+09:00)

- `triggers/slack/new-message/error-formatting.test.ts` is 52 lines and
  `triggers/slack/new-message/listener-lifecycle.test.ts` is 55 lines; the
  previous mixed suite is absent.
- All six Socket Mode scenarios pass 6/6 after the split.

### Final (2026-09-03T21:27:08.3605781+09:00)

- The Socket Mode tests were split by responsibility into error formatting and
  listener lifecycle suites without changing production code or scenario
  behavior.
- Focused tests pass 6/6. The full project evaluator passes: Core 324 test
  files with 717 passed and 3 skipped, evaluation 11/11, document-engine
  39/39, desktop typecheck/build, architecture (1085 modules, 3556
  dependencies), and whitespace checks.

## Current structural task: push trigger transport test boundary split (phase 262)

Split `runtime/trigger-engine/push/slack-folder.test.ts` into Slack message
push and local-folder new-file push tests. Preserve every workflow IR,
connector setup, baseline tick, inbound/file event, notification channel, and
duplicate-prevention assertion; this is a test-organization-only change.

### Success criteria

- `runtime/trigger-engine/push/slack.test.ts` contains Slack baseline/new
  message/once-only coverage and is <= 75 lines.
- `runtime/trigger-engine/push/local-folder.test.ts` contains local-folder
  baseline/new file/once-only coverage and is <= 75 lines.
- The previous mixed `runtime/trigger-engine/push/slack-folder.test.ts` is
  absent; both existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing TriggerEngine behavior, Slack polling, local-folder discovery,
  workflow IR, connector mocks, baseline semantics, notification targets,
  duplicate prevention, assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T21:13:57.6933785+09:00)

- `runtime/trigger-engine/push/slack-folder.test.ts` is 112 lines and combines
  two distinct Slack and local-folder push transport scenarios; the focused
  modules are absent.
- The existing push transport suite passes 2/2. The latest full project
  regression passes: Core 322 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused (2026-09-03T21:18:51.0005793+09:00)

- `runtime/trigger-engine/push/slack.test.ts` is 64 lines and
  `runtime/trigger-engine/push/local-folder.test.ts` is 52 lines; the previous
  mixed suite is absent.
- Both push transport scenarios pass 2/2 after the split.

### Final (2026-09-03T21:22:14.5255418+09:00)

- The push transport tests were split by transport contract into Slack message
  and local-folder new-file suites without changing production code or
  scenario behavior.
- Focused tests pass 2/2. The full project evaluator passes: Core 323 test
  files with 717 passed and 3 skipped, evaluation 11/11, document-engine
  39/39, desktop typecheck/build, architecture (1084 modules, 3555
  dependencies), and whitespace checks.

## Current structural task: discovery replay persistence test boundary split (phase 261)

Split `store/discovery-repository/examples-replay.test.ts` into discovery
example artifact-ID validation and replay-case upsert persistence tests.
Preserve every database row, JSON payload, error code/field, session state,
deduplication update, and assertion; this is a test-organization-only change.

### Success criteria

- `store/discovery-repository/examples-validation.test.ts` contains malformed
  and non-string-array artifact ID validation coverage and is <= 75 lines.
- `store/discovery-repository/replay-upsert.test.ts` contains per-example replay
  upsert/deduplication coverage and is <= 70 lines.
- The previous mixed `store/discovery-repository/examples-replay.test.ts` is
  absent; all three existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing discovery repository parsing, JSON validation, error metadata, replay
  upsert/deduplication, session state, fixtures, assertions, or production
  imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T21:09:41.7931498+09:00)

- `store/discovery-repository/examples-replay.test.ts` is 108 lines and
  combines three artifact-ID validation/replay persistence scenarios; the
  focused modules are absent.
- The existing discovery replay suite passes 3/3. The latest full project
  regression passes: Core 321 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused (2026-09-03T21:11:06.5246071+09:00)

- `examples-validation.test.ts` is 35 lines and `replay-upsert.test.ts` is 39
  lines; the previous mixed suite is absent.
- All three discovery replay scenarios pass 3/3 after the split.

### Final (2026-09-03T21:12:59.5643491+09:00)

- The discovery replay suite was split by persistence contract into artifact-ID
  validation and replay-case upsert/deduplication without changing production
  code or scenario behavior.
- Focused tests pass 3/3. The full project evaluator passes: Core 322 test
  files with 717 passed and 3 skipped, evaluation 11/11, document-engine
  39/39, desktop typecheck/build, architecture, and whitespace checks.

## Current structural task: command transport test boundary split (phase 260)

Split `agent/commands/transport.test.ts` into provider wire normalization and
outer-command protocol rejection tests. Preserve every provider shape, literal
line-break input, canonical reply, internal capability ID, malformed args,
error constant, and assertion; this is a test-organization-only change.

### Success criteria

- `agent/commands/transport/normalization.test.ts` contains Codex, Claude,
  API/local wire normalization coverage and is <= 75 lines.
- `agent/commands/transport/protocol-rejection.test.ts` contains internal
  capability and malformed-args rejection coverage and is <= 45 lines.
- The previous mixed `agent/commands/transport.test.ts` is absent; all eight
  generated scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing provider transport schemas, normalization, canonical commands,
  protocol rejection, parser error exposure, fixtures, assertions, or
  production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T21:05:10.2858912+09:00)

- `agent/commands/transport.test.ts` is 96 lines and combines eight generated
  provider normalization/rejection scenarios; the focused modules are absent.
- The existing transport suite passes 8/8. The latest full project regression
  passes: Core 320 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused (2026-09-03T21:06:29.6838354+09:00)

- `normalization.test.ts` is 43 lines and `protocol-rejection.test.ts` is 25
  lines; the previous mixed suite is absent.
- All eight generated transport scenarios pass 8/8 after the split.

### Final (2026-09-03T21:08:52.6286473+09:00)

- The command transport suite was split by protocol contract into provider wire
  normalization and outer-command rejection without changing production code
  or scenario behavior.
- Focused tests pass 8/8. The full project evaluator passes: Core 321 test
  files with 717 passed and 3 skipped, evaluation 11/11, document-engine
  39/39, desktop typecheck/build, architecture, and whitespace checks.

## Current structural task: agent harness policy test boundary split (phase 259)

Split `agent/harness-policy.test.ts` into cloud data-policy redaction and
cancellation lifecycle tests. Preserve the provider spy, trust settings,
evidence/images, abort behavior, cleanup spies, error codes, and assertions;
this is a test-organization-only change.

### Success criteria

- `agent/harness-policy/fixtures.ts` contains the shared model-provider spy and
  is <= 40 lines.
- `agent/harness-policy/data-policy.test.ts` contains untrusted evidence/image
  redaction coverage and is <= 45 lines.
- `agent/harness-policy/cancellation.test.ts` contains pre-abort and validation
  cleanup coverage and is <= 50 lines.
- The previous mixed `agent/harness-policy.test.ts` is absent; all four
  existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing harness trust policy, evidence/image redaction, provider calls,
  abort handling, cleanup, error codes, fixtures, assertions, or production
  imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T20:59:44.8243393+09:00)

- `agent/harness-policy.test.ts` is 111 lines and combines four data-policy
  and cancellation scenarios; the focused modules are absent.
- The existing harness policy suite passes 4/4. The latest full project
  regression passes: Core 319 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused (2026-09-03T21:01:11.0516875+09:00)

- The shared provider fixture is 21 lines; `data-policy.test.ts` is 37 lines
  and `cancellation.test.ts` is 41 lines. The previous mixed suite is absent.
- All four harness policy scenarios pass 4/4 after the split.

### Final (2026-09-03T21:04:28.1410250+09:00)

- The harness policy suite was split by security contract into cloud
  data-policy redaction and cancellation lifecycle modules, with a shared
  provider spy and no production code changed.
- Focused tests pass 4/4. The full project evaluator passes: Core 320 test
  files with 717 passed and 3 skipped, evaluation 11/11, document-engine
  39/39, desktop typecheck/build, architecture, and whitespace checks.

## Current structural task: local sheet read test boundary split (phase 258)

Split `modules/local-sheet/read.test.ts` into explicit sheet selection and
workbook visibility/content-identity tests. Preserve every workbook fixture,
sheet name, missing-sheet error, visibility state, CSV content, ID assertion,
and cleanup behavior; this is a test-organization-only change.

### Success criteria

- `modules/local-sheet/sheet-selection.test.ts` contains requested/default
  sheet selection and missing-sheet rejection coverage and is <= 50 lines.
- `modules/local-sheet/workbook-identity.test.ts` contains worksheet visibility
  and CSV workbook/table ID stability/change coverage and is <= 75 lines.
- The previous mixed `modules/local-sheet/read.test.ts` is absent; all six
  existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing sheet selection, missing-sheet errors, workbook visibility metadata,
  content-derived IDs, fixtures, file contents, assertions, or production
  imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T20:55:39.0476147+09:00)

- `modules/local-sheet/read.test.ts` is 94 lines and combines six sheet
  selection, workbook metadata, and content-identity scenarios; the focused
  modules are absent.
- The existing local-sheet read suite passes 6/6. The latest full project
  regression passes: Core 318 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused (2026-09-03T20:57:07.9515919+09:00)

- `sheet-selection.test.ts` is 32 lines and `workbook-identity.test.ts` is 54
  lines; the previous mixed suite is absent.
- All six local-sheet read scenarios pass 6/6 after the split.

### Final (2026-09-03T20:58:58.7129748+09:00)

- The local-sheet read suite was split by contract into sheet selection and
  workbook visibility/content identity without changing production code or
  scenario behavior.
- Focused tests pass 6/6. The full project evaluator passes: Core 319 test
  files with 717 passed and 3 skipped, evaluation 11/11, document-engine
  39/39, desktop typecheck/build, architecture, and whitespace checks.

## Current structural task: capability invoke test boundary split (phase 257)

Split `design-tools/capability-invoke.test.ts` into the read-gateway method
guard and HTTP error projection/privacy tests. Preserve every connector mock,
HTTP status, bounded error detail, untrusted-data policy, and assertion; this
is a test-organization-only change.

### Success criteria

- `design-tools/capability-invoke/read-gateway.test.ts` contains generic and
  explicit POST read-gateway rejection coverage and is <= 35 lines.
- `design-tools/capability-invoke/error-projection.test.ts` contains exact
  status/bounded-detail and denied-provider-detail coverage and is <= 75
  lines.
- The previous mixed `design-tools/capability-invoke.test.ts` is absent; all
  four existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing capability method guards, connector invocation, HTTP error status
  projection, bounded details, provider privacy, fixtures, assertions, or
  production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T20:51:39.1093155+09:00)

- `design-tools/capability-invoke.test.ts` is 92 lines and combines four read
  gateway and HTTP error/privacy scenarios; the focused modules are absent.
- The existing capability invoke suite passes 4/4. The latest full project
  regression passes: Core 317 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused (2026-09-03T20:53:04.7971048+09:00)

- `read-gateway.test.ts` is 29 lines and `error-projection.test.ts` is 51
  lines; the previous mixed suite is absent.
- All four capability invoke scenarios pass 4/4 after the split.

### Final (2026-09-03T20:54:52.8933845+09:00)

- The capability invoke suite was split by security contract into read-gateway
  method guards and HTTP error projection/provider-detail privacy without
  changing production code or scenario behavior.
- Focused tests pass 4/4. The full project evaluator passes: Core 318 test
  files with 717 passed and 3 skipped, evaluation 11/11, document-engine
  39/39, desktop typecheck/build, architecture, and whitespace checks.

## Current structural task: table artifact test boundary split (phase 256)

Split `contracts/artifacts/table.test.ts` into structured `TableArtifact`
validation/profile behavior and local XLSX workbook reading. Preserve every
table shape, extrema rule, duplicate-header mapping, workbook fixture, sheet,
profile, and assertion; this is a test-organization-only change.

### Success criteria

- `contracts/artifacts/table-artifact.test.ts` contains table schema/profile and
  header-normalization coverage and is <= 55 lines.
- `contracts/artifacts/local-sheet-read.test.ts` contains XLSX workbook/table
  artifact read coverage and is <= 35 lines.
- The previous mixed `contracts/artifacts/table.test.ts` is absent; all four
  existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing TableArtifact validation, extrema profiling, header normalization,
  local-sheet reading, workbook fixtures, sheet names, assertions, or
  production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T20:47:30.9749474+09:00)

- `contracts/artifacts/table.test.ts` is 90 lines and combines four table
  artifact and local workbook-read scenarios; the focused modules are absent.
- The existing table artifact suite passes 4/4. The latest full project
  regression passes: Core 316 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused (2026-09-03T20:49:05.3429345+09:00)

- `table-artifact.test.ts` is 52 lines and `local-sheet-read.test.ts` is 27
  lines; the previous mixed suite is absent.
- All four table artifact/workbook scenarios pass 4/4 after the split.

### Final (2026-09-03T20:50:54.2854351+09:00)

- The TableArtifact suite was split by contract into structured artifact
  validation/profiling and local workbook reading without changing production
  code or scenario behavior.
- Focused tests pass 4/4. The full project evaluator passes: Core 317 test
  files with 717 passed and 3 skipped, evaluation 11/11, document-engine
  39/39, desktop typecheck/build, architecture, and whitespace checks.

## Current structural task: RDB config test boundary split (phase 255)

Split `modules/rdb/config.test.ts` into connection-string validation, config
parsing/row-limit normalization, and SQLite probe tests. Preserve every
database type, URL, allowlist, limit edge case, temporary fixture, cleanup,
error code, and assertion; this is a test-organization-only change.

### Success criteria

- `modules/rdb/connection-string.test.ts` contains PostgreSQL/MySQL URL
  validation coverage and is <= 30 lines.
- `modules/rdb/config-parsing.test.ts` contains database config parsing and
  row-limit normalization coverage and is <= 55 lines.
- `modules/rdb/probe.test.ts` contains readable/missing SQLite probe coverage
  and is <= 45 lines.
- The previous mixed `modules/rdb/config.test.ts` is absent; all five existing
  scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing RDB URL validation, config parsing, allowlists, row limits, SQLite
  probing, error codes, fixtures, cleanup, assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T20:41:57.4069822+09:00)

- `modules/rdb/config.test.ts` is 96 lines and combines five URL validation,
  configuration, normalization, and probe scenarios; the focused modules are
  absent.
- The existing RDB config suite passes 5/5. The latest full project regression
  passes: Core 314 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused (2026-09-03T20:44:05.2807570+09:00)

- `connection-string.test.ts` is 14 lines, `config-parsing.test.ts` is 55
  lines, and `probe.test.ts` is 27 lines; the previous mixed suite is absent.
- An initial structural check found `config-parsing.test.ts` one line over its
  limit; removing one blank separator corrected only test layout, after which
  all five RDB config scenarios pass 5/5.

### Final (2026-09-03T20:46:46.3316972+09:00)

- The RDB config suite was split by contract into URL validation,
  config/row-limit parsing, and SQLite probing without changing production code
  or scenario behavior.
- Focused tests pass 5/5. The full project evaluator passes: Core 316 test
  files with 717 passed and 3 skipped, evaluation 11/11, document-engine
  39/39, desktop typecheck/build, architecture, and whitespace checks.

## Current structural task: local-folder connection test boundary split (phase 254)

Split `modules/local-folder/connection.test.ts` into connection
configuration/lifecycle and path identity/matching tests. Preserve every folder
shape, Windows normalization case, POSIX case rule, fallback guard, and
assertion; this is a test-organization-only change.

### Success criteria

- `modules/local-folder/config-lifecycle.test.ts` contains config parsing and
  folder add/remove/status coverage and is <= 45 lines.
- `modules/local-folder/path-matching.test.ts` contains Windows/POSIX path
  identity and explicit-folder matching coverage and is <= 70 lines.
- The previous mixed `modules/local-folder/connection.test.ts` is absent; all
  six existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing local-folder config parsing, folder lifecycle, path normalization,
  case sensitivity, matching, fallback behavior, fixtures, assertions, or
  production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T20:37:44.5151623+09:00)

- `modules/local-folder/connection.test.ts` is 93 lines and combines six
  configuration/lifecycle and path identity/matching scenarios; the focused
  modules are absent.
- The existing local-folder connection suite passes 6/6. The latest full
  project regression passes: Core 313 files with 717 passed and 3 skipped,
  eval 11/11, document-engine 39/39, desktop typecheck/build, architecture,
  and whitespace checks.

### Focused (2026-09-03T20:39:11.4471212+09:00)

- `config-lifecycle.test.ts` is 37 lines and `path-matching.test.ts` is 59
  lines; the previous mixed suite is absent.
- All six local-folder connection scenarios pass 6/6 after the split.

### Final (2026-09-03T20:41:11.3937994+09:00)

- The local-folder connection suite was split by contract into configuration /
  lifecycle and platform path identity / matching without changing production
  code or scenario behavior.
- Focused tests pass 6/6. The full project evaluator passes: Core 314 test
  files with 717 passed and 3 skipped, evaluation 11/11, document-engine
  39/39, desktop typecheck/build, architecture, and whitespace checks.

## Current structural task: CLI JSON test boundary split (phase 253)

Split `agent/model/cli/json.test.ts` into structured-output parsing, Zod schema
conversion, and raw JSON object parsing/error recovery. Preserve every schema,
wrapper shape, investigation output contract, parser input, error message,
and assertion; this is a test-organization-only change.

### Success criteria

- `agent/model/cli/structured-output.test.ts` contains fenced/wrapper
  structured-output parsing coverage and is <= 35 lines.
- `agent/model/cli/schema-conversion.test.ts` contains object, record,
  investigation, union, and root-schema conversion coverage and is <= 65
  lines.
- `agent/model/cli/json-object.test.ts` contains CLI error, first-object, and
  control-character recovery coverage and is <= 45 lines.
- The previous mixed `agent/model/cli/json.test.ts` is absent; all ten
  existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing structured-output parsing, schema conversion, investigation schema
  handling, JSON object parsing, error text, fixtures, assertions, or
  production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T20:30:46.1013576+09:00)

- `agent/model/cli/json.test.ts` is 101 lines and combines ten structured
  output, schema conversion, and raw JSON parsing scenarios; the focused
  modules are absent.
- The existing CLI JSON suite passes 10/10. The latest full project regression
  passes: Core 311 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused (2026-09-03T20:33:18.8168182+09:00)

- `structured-output.test.ts` is 27 lines, `schema-conversion.test.ts` is 46
  lines, and `json-object.test.ts` is 30 lines; the previous mixed suite is
  absent.
- All ten CLI JSON scenarios pass 10/10 after the split.

### Final (2026-09-03T20:36:56.6551839+09:00)

- The CLI JSON suite was split by contract into structured-output parsing,
  schema conversion, and raw JSON object parsing/recovery without changing
  production code or scenario behavior.
- Focused tests pass 10/10. The full project evaluator passes: Core 313 test
  files with 717 passed and 3 skipped, evaluation 11/11, document-engine
  39/39, desktop typecheck/build, architecture, and whitespace checks.

## Current structural task: local sheet discovery test boundary split (phase 252)

Split `modules/local-sheet/discovery-source.test.ts` into workbook listing /
profiling, connected-folder path safety, and unavailable/corrupt input
handling. Preserve every workbook fixture, connected-folder configuration,
source ID, budget assertion, and profile result; this is a
test-organization-only change.

### Success criteria

- `modules/local-sheet/discovery-source/fixtures.ts` contains shared workbook
  and context setup and is <= 50 lines.
- `modules/local-sheet/discovery-source/listing-and-profiling.test.ts` contains
  spreadsheet enumeration and profile coverage and is <= 55 lines.
- `modules/local-sheet/discovery-source/path-safety.test.ts` contains the
  connected-folder boundary rejection coverage and is <= 35 lines.
- `modules/local-sheet/discovery-source/unavailable-inputs.test.ts` contains
  inaccessible-folder and corrupt-workbook coverage and is <= 45 lines.
- The previous mixed `modules/local-sheet/discovery-source.test.ts` is absent;
  all three existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing local-sheet discovery, workbook parsing, folder allowlists, source
  IDs, budgets, corrupt-input handling, fixtures, assertions, or production
  imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T20:25:48.2505579+09:00)

- `modules/local-sheet/discovery-source.test.ts` is 113 lines and combines
  three listing/profiling, path-safety, and unavailable-input scenarios; the
  focused modules are absent.
- The existing local-sheet discovery suite passes 3/3. The latest full project
  regression passes: Core 309 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused (2026-09-03T20:27:45.6113502+09:00)

- The shared fixture is 35 lines; `listing-and-profiling.test.ts` is 45 lines,
  `path-safety.test.ts` is 19 lines, and `unavailable-inputs.test.ts` is 29
  lines. The previous mixed suite is absent.
- All three local-sheet discovery scenarios pass 3/3 after the split.

### Final (2026-09-03T20:29:44.2368805+09:00)

- The local-sheet discovery suite was split by contract into listing/profiling,
  path safety, and unavailable/corrupt input handling, with shared test
  fixtures extracted and no production code changed.
- Focused tests pass 3/3. The full project evaluator passes: Core 311 test
  files with 717 passed and 3 skipped, evaluation 11/11, document-engine
  39/39, desktop typecheck/build, architecture, and whitespace checks.

## Current structural task: transform connector test boundary split (phase 251)

Split `modules/transform/connector.test.ts` into table-to-text serialization
compatibility and expression-evaluation boundary tests. Preserve every table
artifact, raw-row input, aggregate/ratio expression, output path, context, and
assertion; this is a test-organization-only change.

### Success criteria

- `modules/transform/serialization.test.ts` contains TableArtifact and array
  input serialization coverage and is <= 55 lines.
- `modules/transform/expression-evaluation.test.ts` contains single-source and
  multi-source expression evaluation coverage and is <= 85 lines.
- The previous mixed `modules/transform/connector.test.ts` is absent; all four
  existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing transform connector execution, table artifact conversion, array
  compatibility, expression evaluation, source tables, output paths, fixtures,
  assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T20:21:33.9833620+09:00)

- `modules/transform/connector.test.ts` is 112 lines and combines four
  serialization and expression-evaluation scenarios; the focused modules are
  absent.
- The existing TransformConnector suite passes 4/4. The latest full project
  regression passes: Core 308 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused (2026-09-03T20:23:00.3243769+09:00)

- `serialization.test.ts` is 51 lines and `expression-evaluation.test.ts` is
  75 lines; the previous mixed suite is absent.
- All four TransformConnector scenarios pass 4/4 after the split.

### Final (2026-09-03T20:24:48.2296126+09:00)

- The TransformConnector suite was split by behavioral boundary into
  table-to-text serialization compatibility and expression evaluation without
  changing production code or scenario behavior.
- Focused tests pass 4/4. The full project evaluator passes: Core 309 test
  files with 717 passed and 3 skipped, evaluation 11/11, document-engine
  39/39, desktop typecheck/build, architecture, and whitespace checks.

## Current structural task: retrieval test boundary split (phase 250)

Split `retrieval/retrieval.test.ts` into local retrieval-index behavior and
`sources.search` gateway behavior. Preserve every fixture, ACL/deletion rule,
snippet policy, index toggle, citation, and assertion; this is a
test-organization-only change.

### Success criteria

- `retrieval/local-index.test.ts` contains local search ranking, stale-file
  cleanup, and snippet-policy coverage and is <= 55 lines.
- `retrieval/source-search.test.ts` contains disabled-index fallback and
  enabled-index citation coverage and is <= 75 lines.
- The previous mixed `retrieval/retrieval.test.ts` is absent; all five existing
  scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing retrieval indexing, ACL filtering, deletion handling, snippet
  limits, source-search fallback, citations, fixtures, assertions, or
  production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T20:16:55.8981578+09:00)

- `retrieval/retrieval.test.ts` is 113 lines and combines five local-index,
  snippet-policy, and source-search scenarios; the focused modules are absent.
- The existing retrieval suite passes 5/5. The latest full project regression
  passes: Core 307 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused (2026-09-03T20:18:53.9359995+09:00)

- `local-index.test.ts` is 55 lines and `source-search.test.ts` is 69 lines;
  the previous mixed suite is absent.
- All five retrieval scenarios pass 5/5 after the split.

### Final (2026-09-03T20:20:43.1100519+09:00)

- The retrieval suite was split by behavioral boundary into local index/snippet
  policy and `sources.search` gateway modules without changing production code
  or scenario behavior.
- Focused tests pass 5/5. The full project evaluator passes: Core 308 test
  files with 717 passed and 3 skipped, evaluation 11/11, document-engine
  39/39, desktop typecheck/build, architecture, and whitespace checks.

## Current structural task: default AI conclusion test split (phase 249)

Split `workflow/bindings/default-conclusion.test.ts` into with-schema and
without-schema test modules. Preserve every AI step, output schema, inferred
binding, runtime output, message channel, and assertion; this is a
test-organization-only change.

### Success criteria

- `workflow/bindings/default-conclusion/with-schema.test.ts` contains the
  custom-output-schema default conclusion coverage and is <= 60 lines.
- `workflow/bindings/default-conclusion/without-schema.test.ts` contains the
  no-custom-schema default conclusion coverage and is <= 60 lines.
- The previous mixed `workflow/bindings/default-conclusion.test.ts` is absent;
  both existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing default AI conclusion inference, custom schema handling, message
  binding, runtime output projection, fixtures, assertions, or production
  imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T20:09:08.3514018+09:00)

- `workflow/bindings/default-conclusion.test.ts` is 107 lines and combines two
  default-conclusion scenarios; the focused modules are absent.
- The existing default-conclusion suite passes 2/2. The latest full project
  regression passes: Core 306 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused (2026-09-03T20:13:07.0760539+09:00)

- `with-schema.test.ts` is 20 lines and `without-schema.test.ts` is 20 lines;
  the previous mixed suite is absent.
- Both default-conclusion scenarios pass 2/2 after the split.

### Final (2026-09-03T20:15:55.3345046+09:00)

- The default AI conclusion suite was split into custom-schema and no-schema
  modules without changing production code or scenario behavior.
- Focused tests pass 2/2. The full project evaluator passes: Core 307 test
  files with 717 passed and 3 skipped, evaluation 11/11, document-engine
  39/39, desktop typecheck/build, architecture, and whitespace checks.

## Current structural task: RDB client test split (phase 246)

Split `modules/rdb/client.test.ts` into PostgreSQL result types, table-reference
helpers, and table/schema allowlist test modules. Preserve every driver mock,
parser, connection config, table reference, schema, allowlist, and assertion;
this is a test-organization-only change.

### Success criteria

- `modules/rdb/client/result-types.test.ts` contains DATE/timestamp parser
  behavior and is <= 80 lines.
- `modules/rdb/client/table-refs.test.ts` contains table ref parse/format
  coverage and is <= 30 lines.
- `modules/rdb/client/table-allowlist.test.ts` contains table and schema
  allowlist coverage and is <= 40 lines.
- The previous mixed `modules/rdb/client.test.ts` is absent; all four existing
  scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing PostgreSQL parser registration, query results, connection setup,
  table-reference parsing/formatting, allowlist semantics, driver mocks,
  fixtures, assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T19:56:13.4598520+09:00)

- `modules/rdb/client.test.ts` is 108 lines and combines four database
  result/helper/allowlist scenarios; the focused client modules are absent.
- The existing RDB client suite passes 4/4. The latest full project regression
  passes: Core 299 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused verification (2026-09-03T19:57:59.2480053+09:00)

- All three focused RDB client suites pass 4/4.
- `result-types.test.ts` is 41 lines, `table-refs.test.ts` is 14 lines, and
  `table-allowlist.test.ts` is 21 lines; the mixed root suite is absent.

### Final verification (2026-09-03T19:59:49.4043798+09:00)

- The three focused RDB client suites remain green at 4/4.
- Core tests passed with 301 files, 717 passed, and 3 skipped; core eval
  passed 11/11; document-engine passed 39/39; desktop typecheck/build,
  architecture (1060 modules, 3510 dependencies), and `git diff --check`
  passed.
- No production code changed; the mixed RDB client suite was split into
  result-type, table-reference, and allowlist modules.

## Current structural task: design-tools source access test split (phase 245)

Split `design-tools/source-access.test.ts` into bounded read/path, untrusted
policy, and disconnected-connection test modules. Preserve every temporary
folder, document-engine seam, source path, maxChars bound, permission context,
connection state, and assertion; this is a test-organization-only change.

### Success criteria

- `design-tools/source-access/bounded-read.test.ts` contains bounded PDF read
  and path-boundary coverage and is <= 70 lines.
- `design-tools/source-access/untrusted-policy.test.ts` contains local-data
  permission denial coverage and is <= 40 lines.
- `design-tools/source-access/disconnected-connection.test.ts` contains
  disabled-connection list/read denial coverage and is <= 35 lines.
- The previous mixed `design-tools/source-access.test.ts` is absent; all three
  existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing design-tool source reading, path containment, document-engine
  behavior, maxChars limits, untrusted-data policy, connection checks, mocks,
  cleanup, assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T19:51:50.4590150+09:00)

- `design-tools/source-access.test.ts` is 119 lines and combines three source
  access/policy/connection scenarios; the focused source-access modules are
  absent.
- The existing source-access suite passes 3/3. The latest full project
  regression passes: Core 297 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused verification (2026-09-03T19:53:23.5818466+09:00)

- All three focused design-tools source-access suites pass 3/3.
- `bounded-read.test.ts` is 35 lines, `untrusted-policy.test.ts` is 21 lines,
  and `disconnected-connection.test.ts` is 20 lines; the mixed root suite is
  absent.

### Final verification (2026-09-03T19:55:12.5007799+09:00)

- The three focused design-tools source-access suites remain green at 3/3.
- Core tests passed with 299 files, 717 passed, and 3 skipped; core eval
  passed 11/11; document-engine passed 39/39; desktop typecheck/build,
  architecture (1058 modules, 3507 dependencies), and `git diff --check`
  passed.
- No production code changed; the mixed source-access suite was split into
  bounded read/path, untrusted policy, and disconnected connection modules.

## Current structural task: HTTP read response test split (phase 244)

Split `modules/http/connector/methods/read-responses.test.ts` into success,
status-failure, bounded-error-details, and truncation test modules. Preserve
every fetch stub, URL, method, response status, error code, body preview,
truncation flag, and assertion; this is a test-organization-only change.

### Success criteria

- `modules/http/connector/methods/read-responses/success.test.ts` contains
  successful GET response coverage and is <= 40 lines.
- `modules/http/connector/methods/read-responses/status-failures.test.ts`
  contains 4xx/5xx failure mapping coverage and is <= 35 lines.
- `modules/http/connector/methods/read-responses/error-details.test.ts`
  contains bounded structured error details coverage and is <= 40 lines.
- `modules/http/connector/methods/read-responses/truncation.test.ts` contains
  capped error body coverage and is <= 35 lines.
- The previous mixed `modules/http/connector/methods/read-responses.test.ts`
  is absent; all four existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing HTTP fetch behavior, base URL resolution, redirect policy, status
  mapping, error detail limits, truncation flags, fixtures, assertions, or
  production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T19:47:19.7904221+09:00)

- `modules/http/connector/methods/read-responses.test.ts` is 115 lines and
  combines four response/error scenarios; the focused response modules are
  absent.
- The existing read-responses suite passes 4/4. The latest full project
  regression passes: Core 294 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused verification (2026-09-03T19:48:47.7221107+09:00)

- All four focused HTTP read response suites pass 4/4.
- `success.test.ts` is 13 lines, `status-failures.test.ts` is 15 lines,
  `error-details.test.ts` is 16 lines, and `truncation.test.ts` is 15 lines;
  the mixed root suite is absent.

### Final verification (2026-09-03T19:50:59.5734360+09:00)

- The four focused HTTP read response suites remain green at 4/4.
- Core tests passed with 297 files, 717 passed, and 3 skipped; core eval
  passed 11/11; document-engine passed 39/39; desktop typecheck/build,
  architecture (1056 modules, 3498 dependencies), and `git diff --check`
  passed.
- No production code changed; the mixed read-response suite was split into
  success, status-failure, bounded-detail, and truncation modules.

## Current structural task: Gmail polling error test split (phase 243)

Split `modules/gmail/new-message-poll/errors.test.ts` into deleted-message,
message-lookup-error, and history-error test modules. Preserve every Gmail mock,
status/code value, history cursor, seen-message list, event, rejection identity,
and call-count assertion; this is a test-organization-only change.

### Success criteria

- `modules/gmail/new-message-poll/errors/deleted-message.test.ts` contains
  post-listing deletion handling and is <= 55 lines.
- `modules/gmail/new-message-poll/errors/message-lookup-errors.test.ts`
  contains message lookup rejection and 404-text false-positive coverage and
  is <= 55 lines.
- `modules/gmail/new-message-poll/errors/history-errors.test.ts` contains
  history lookup rejection and fallback-call guard coverage and is <= 35 lines.
- The previous mixed `modules/gmail/new-message-poll/errors.test.ts` is absent;
  all four existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing Gmail polling, 404 handling, history cursor behavior, error
  identity, fallback calls, mocks, assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T19:43:13.6294399+09:00)

- `modules/gmail/new-message-poll/errors.test.ts` is 117 lines and combines
  four message/history error-boundary scenarios; the focused error modules are
  absent.
- The existing Gmail error suite passes 4/4. The latest full project
  regression passes: Core 292 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused verification (2026-09-03T19:44:35.9950791+09:00)

- All three focused Gmail polling error suites pass 4/4.
- `deleted-message.test.ts` is 14 lines, `message-lookup-errors.test.ts` is
  15 lines, and `history-errors.test.ts` is 14 lines; the mixed root suite is
  absent.

### Final verification (2026-09-03T19:46:21.2006171+09:00)

- The three focused Gmail polling error suites remain green at 4/4.
- Core tests passed with 294 files, 717 passed, and 3 skipped; core eval
  passed 11/11; document-engine passed 39/39; desktop typecheck/build,
  architecture (1053 modules, 3495 dependencies), and `git diff --check`
  passed.
- No production code changed; the mixed Gmail error suite was split into
  deleted-message, message-lookup, and history-error modules.

## Current structural task: structured transform binding test split (phase 242)

Split `workflow/bindings/structured-transform.test.ts` into HTTP response-body
and snapshot-table binding test modules. Preserve every WorkflowIR step,
response shape, source id, binding, input rows, and assertion; this is a
test-organization-only change.

### Success criteria

- `workflow/bindings/structured-transform/http-response-body.test.ts` contains
  structured HTTP response body forwarding coverage and is <= 65 lines.
- `workflow/bindings/structured-transform/snapshot-tables.test.ts` contains
  source-grouped snapshot table coverage and is <= 70 lines.
- The previous mixed `workflow/bindings/structured-transform.test.ts` is
  absent; both existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing structured response extraction, transform table grouping, source
  IDs, bindings, input values, WorkflowIR fixtures, assertions, or production
  imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T19:39:21.8671064+09:00)

- `workflow/bindings/structured-transform.test.ts` is 117 lines and combines
  two structured-transform binding scenarios; the focused modules are absent.
- The existing structured-transform suite passes 2/2. The latest full project
  regression passes: Core 291 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused verification (2026-09-03T19:40:37.8603636+09:00)

- Both focused structured-transform suites pass 2/2.
- `http-response-body.test.ts` is 29 lines and `snapshot-tables.test.ts` is
  39 lines; the mixed root suite is absent.

### Final verification (2026-09-03T19:42:24.9827038+09:00)

- Both focused structured-transform suites remain green at 2/2.
- Core tests passed with 292 files, 717 passed, and 3 skipped; core eval
  passed 11/11; document-engine passed 39/39; desktop typecheck/build,
  architecture (1051 modules, 3493 dependencies), and `git diff --check`
  passed.
- No production code changed; the mixed structured-transform suite was split
  into HTTP response-body and snapshot-table modules.

## Current structural task: workflow save persistence test split (phase 241)

Split `store/workflow-repository/workflow-save.test.ts` into version/activation,
durable reopen, and validation-guard test modules. Preserve every workflow
field, version, active state, database path, cleanup, validation message, and
assertion; this is a test-organization-only change.

### Success criteria

- `store/workflow-repository/workflow-save/version-and-activation.test.ts`
  contains monotonic version and disabled-by-default coverage and is <= 45
  lines.
- `store/workflow-repository/workflow-save/durable-reopen.test.ts` contains
  committed workflow database reopen coverage and is <= 45 lines.
- `store/workflow-repository/workflow-save/validation-guard.test.ts` contains
  missing action parameter rejection coverage and is <= 45 lines.
- The previous mixed `store/workflow-repository/workflow-save.test.ts` is
  absent; all four existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing workflow version allocation, activation defaults, database
  persistence/reopen behavior, validation messages, cleanup, fixtures,
  assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T19:35:22.9700229+09:00)

- `store/workflow-repository/workflow-save.test.ts` is 114 lines and combines
  four versioning, activation, persistence, and validation scenarios; the
  focused workflow-save modules are absent.
- The existing workflow-save suite passes 4/4. The latest full project
  regression passes: Core 289 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused verification (2026-09-03T19:36:48.1899581+09:00)

- All three focused workflow-save suites pass 4/4.
- `version-and-activation.test.ts` is 20 lines, `durable-reopen.test.ts` is
  23 lines, and `validation-guard.test.ts` is 24 lines; the mixed root suite
  is absent.

### Final verification (2026-09-03T19:38:34.9838362+09:00)

- The three focused workflow-save suites remain green at 4/4.
- Core tests passed with 291 files, 717 passed, and 3 skipped; core eval
  passed 11/11; document-engine passed 39/39; desktop typecheck/build,
  architecture (1050 modules, 3491 dependencies), and `git diff --check`
  passed.
- No production code changed; the mixed workflow-save suite was split into
  version/activation, durable reopen, and validation guard modules.

## Current structural task: AI output contract test split (phase 240)

Split `workflow/contract-validator/ai-output.test.ts` into undeclared-field,
missing-schema, and optional-output test modules. Preserve every WorkflowIR
step, output schema, reference, binding, issue code, step id, and assertion;
this is a test-organization-only change.

### Success criteria

- `workflow/contract-validator/ai-output/undeclared-field.test.ts` contains
  undeclared AI output reference coverage and is <= 45 lines.
- `workflow/contract-validator/ai-output/missing-schema.test.ts` contains
  missing output-schema coverage and is <= 45 lines.
- `workflow/contract-validator/ai-output/optional-output.test.ts` contains
  optional downstream param/binding coverage and is <= 55 lines.
- The previous mixed `workflow/contract-validator/ai-output.test.ts` is
  absent; all three existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing AI output reference validation, schema requiredness, binding
  validation, issue codes/messages, WorkflowIR fixtures, assertions, or
  production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T19:31:27.5164988+09:00)

- `workflow/contract-validator/ai-output.test.ts` is 114 lines and combines
  three AI output reference contract scenarios; the focused modules are absent.
- The existing AI-output validator suite passes 3/3. The latest full project
  regression passes: Core 287 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused verification (2026-09-03T19:32:50.1098062+09:00)

- All three focused AI output validator suites pass 3/3.
- `undeclared-field.test.ts` is 32 lines, `missing-schema.test.ts` is 20
  lines, and `optional-output.test.ts` is 39 lines; the mixed root suite is
  absent.

### Final verification (2026-09-03T19:34:36.3788951+09:00)

- The three focused AI output validator suites remain green at 3/3.
- Core tests passed with 289 files, 717 passed, and 3 skipped; core eval
  passed 11/11; document-engine passed 39/39; desktop typecheck/build,
  architecture (1048 modules, 3487 dependencies), and `git diff --check`
  passed.
- No production code changed; the mixed AI output suite was split into three
  bounded validation modules.

## Current structural task: command discovery test split (phase 239)

Split `agent/commands/service/discovery.test.ts` into source-file discovery,
untrusted-source policy, and execution-explanation test modules. Preserve every
temporary folder, connection, source command, policy context, execution IR,
failure issue, redaction, and response assertion; this is a test-organization-
only change.

### Success criteria

- `agent/commands/service/discovery/source-files.test.ts` contains source file
  discovery coverage and is <= 35 lines.
- `agent/commands/service/discovery/untrusted-source-policy.test.ts` contains
  the denied PDF-body policy coverage and is <= 35 lines.
- `agent/commands/service/discovery/execution-explain.test.ts` contains
  execution failure explanation and raw-payload redaction coverage and is <=
  85 lines.
- The previous mixed `agent/commands/service/discovery.test.ts` is absent; all
  three existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing source discovery routing, local-folder setup, untrusted-data policy,
  execution explanation, issue projection, redaction, fixtures, assertions, or
  production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T19:27:20.4759613+09:00)

- `agent/commands/service/discovery.test.ts` is 124 lines and combines three
  source, policy, and execution-explanation scenarios; the focused discovery
  modules are absent.
- The existing discovery suite passes 3/3. The latest full project regression
  passes: Core 285 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused verification (2026-09-03T19:28:54.0703600+09:00)

- All three focused command discovery suites pass 3/3.
- `source-files.test.ts` is 20 lines, `untrusted-source-policy.test.ts` is
  22 lines, and `execution-explain.test.ts` is 57 lines; the mixed root suite
  is absent.

### Final verification (2026-09-03T19:30:40.6275554+09:00)

- The three focused command discovery suites remain green at 3/3.
- Core tests passed with 287 files, 717 passed, and 3 skipped; core eval
  passed 11/11; document-engine passed 39/39; desktop typecheck/build,
  architecture (1046 modules, 3481 dependencies), and `git diff --check`
  passed.
- No production code changed; the mixed discovery suite was split into
  source, policy, and execution-explanation modules.

## Current structural task: HTTP connection test split (phase 238)

Split `modules/http/connection.test.ts` into endpoint parsing,
upsert/removal, secret/status, and saved-connection matching test modules.
Preserve every endpoint id, URL, label, auth state, secret, connection status,
precedence, and assertion; this is a test-organization-only change.

### Success criteria

- `modules/http/connection/parsing.test.ts` contains legacy and multi-endpoint
  parsing coverage and is <= 35 lines.
- `modules/http/connection/upsert-remove.test.ts` contains endpoint upsert and
  removal/ID-precedence coverage and is <= 50 lines.
- `modules/http/connection/secrets-status.test.ts` contains secret migration,
  authStored, merge, and status coverage and is <= 60 lines.
- `modules/http/connection/matching.test.ts` contains saved-connection matching
  coverage and is <= 25 lines.
- The previous mixed `modules/http/connection.test.ts` is absent; all eight
  existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing HTTP endpoint parsing, serialization, upsert/remove semantics,
  secret handling, connection status, matching precedence, fixtures, or
  production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T19:23:05.1724341+09:00)

- `modules/http/connection.test.ts` is 122 lines and combines eight endpoint
  configuration and connection-state scenarios; the focused connection test
  modules are absent.
- The existing connection suite passes 8/8. The latest full project
  regression passes: Core 282 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused verification (2026-09-03T19:24:38.2090433+09:00)

- All four focused HTTP connection suites pass 8/8.
- `parsing.test.ts` is 15 lines, `upsert-remove.test.ts` is 20 lines,
  `secrets-status.test.ts` is 29 lines, and `matching.test.ts` is 13 lines;
  the mixed root suite is absent.

### Final verification (2026-09-03T19:26:25.0602703+09:00)

- The four focused HTTP connection suites remain green at 8/8.
- Core tests passed with 285 files, 717 passed, and 3 skipped; core eval
  passed 11/11; document-engine passed 39/39; desktop typecheck/build,
  architecture (1044 modules, 3472 dependencies), and `git diff --check`
  passed.
- No production code changed; the mixed connection suite was split into
  four responsibility-oriented test modules.

## Current structural task: execution-result projection test split (phase 237)

Split `runtime/execution-result/projection.test.ts` into bounded-result,
pending-update, and ephemeral-projection test modules. Preserve every chat,
execution, log, redaction, status-transition, event, and message assertion;
this is a test-organization-only change.

### Success criteria

- `runtime/execution-result/projection/writes-bounded-result.test.ts` contains
  bounded success projection and payload-redaction coverage and is <= 65 lines.
- `runtime/execution-result/projection/pending-update.test.ts` contains the
  pending-approval-to-success in-place update coverage and is <= 45 lines.
- `runtime/execution-result/projection/ephemeral-projection.test.ts` contains
  ephemeral execution projection coverage and is <= 45 lines.
- The previous mixed `runtime/execution-result/projection.test.ts` is absent;
  all three existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing execution-result formatting, log contents, payload redaction,
  message deduplication, pending status updates, ephemeral execution handling,
  fixtures, assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T19:18:43.5949912+09:00)

- `runtime/execution-result/projection.test.ts` is 127 lines and combines
  three result-projection scenarios; the focused projection modules are
  absent.
- The existing projection suite passes 3/3. The latest full project
  regression passes: Core 280 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused verification (2026-09-03T19:20:23.5092645+09:00)

- All three focused execution-result projection suites pass 3/3.
- `writes-bounded-result.test.ts` is 39 lines, `pending-update.test.ts` is
  24 lines, and `ephemeral-projection.test.ts` is 19 lines; the mixed root
  suite is absent.

### Final verification (2026-09-03T19:22:13.0523381+09:00)

- The three focused execution-result projection suites remain green at 3/3.
- Core tests passed with 282 files, 717 passed, and 3 skipped; core eval
  passed 11/11; document-engine passed 39/39; desktop typecheck/build,
  architecture (1041 modules, 3469 dependencies), and `git diff --check`
  passed.
- No production code changed; the mixed projection suite was split into
  three bounded state-oriented test modules.

## Current structural task: Work Discovery compile test split (phase 236)

Split `work-discovery/compile/compile.test.ts` into focused blueprint,
WorkflowIR, multi-source transform, and publish-gate test modules. Preserve the
shared session fixture and every existing candidate, mapping, source, binding,
validation, and gate assertion; this is a test-organization-only change.

### Success criteria

- `work-discovery/compile/fixtures.ts` contains the shared session fixture and
  is <= 45 lines.
- `work-discovery/compile/blueprint-publish.test.ts` contains publishable
  blueprint coverage and is <= 30 lines.
- `work-discovery/compile/workflow-ir.test.ts` contains WorkflowIR validation
  and preserved mapping coverage and is <= 45 lines.
- `work-discovery/compile/multi-source-transform.test.ts` contains multi-source
  binding coverage and is <= 55 lines.
- `work-discovery/compile/publish-gate.test.ts` contains replay-gate rejection
  coverage and is <= 20 lines.
- The previous mixed `work-discovery/compile/compile.test.ts` is absent; all
  four existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing blueprint construction, candidate scores, source mappings,
  WorkflowIR shape, binding generation, validation, publish-gate behavior,
  fixtures, assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T19:13:43.2015858+09:00)

- `work-discovery/compile/compile.test.ts` is 129 lines and combines four
  compile/publish scenarios; the focused compile modules are absent.
- The existing compile suite passes 4/4. The latest full project regression
  also passes: Core 277 files with 717 passed and 3 skipped, eval 11/11,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks.

### Focused verification (2026-09-03T19:15:43.8277606+09:00)

- All four focused Work Discovery compile suites pass 4/4.
- The shared fixture is 29 lines; blueprint-publish is 19 lines,
  WorkflowIR is 24 lines, multi-source-transform is 32 lines, and
  publish-gate is 9 lines. The mixed root suite is absent.

### Final verification (2026-09-03T19:17:36.0609033+09:00)

- The four focused Work Discovery compile suites remain green at 4/4.
- Core tests passed with 280 files, 717 passed, and 3 skipped; core eval
  passed 11/11; document-engine passed 39/39; desktop typecheck/build,
  architecture (1039 modules, 3460 dependencies), and `git diff --check`
  passed.
- No production code changed; the mixed compile suite was split into a
  shared fixture and four bounded test modules.

## Current structural task: workflow-definition command test split (phase 235)

Split `agent/commands/service/workflow-definition.test.ts` into focused
versioned-command, catalog-action-contract, and HTTP-write-contract test
modules. Preserve every create/update/delete argument, version, conflict,
workflow step, actionRef, sideEffect, HTTP connection, payload, context, and
response assertion; this is a test-organization-only change.

### Success criteria

- `agent/commands/service/workflow-definition/versioned-commands.test.ts`
  contains versioned create/update/delete and stale-conflict coverage and is
  <= 55 lines.
- `agent/commands/service/workflow-definition/catalog-action-contract.test.ts`
  contains catalog-provided actionRef/sideEffect coverage and is <= 45 lines.
- `agent/commands/service/workflow-definition/http-write-contract.test.ts`
  contains HTTP POST write normalization coverage and is <= 45 lines.
- The previous mixed `agent/commands/service/workflow-definition.test.ts` is
  absent; all three existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing workflow command versioning, stale conflicts, step normalization,
  action catalog resolution, actionRef/sideEffect values, HTTP write setup,
  payloads, context handling, fixtures, assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T19:04:46.1665443+09:00)

- `agent/commands/service/workflow-definition.test.ts` is 130 lines and
  combines versioned workflow mutation, catalog action contracts, and HTTP
  POST normalization; the focused workflow-definition test directory is
  absent.
- The existing workflow-definition suite passes 3/3. Core typecheck, tests,
  evaluation, document-engine 39/39, desktop typecheck/build, architecture,
  and whitespace checks pass.

### Focused verification (2026-09-03T19:09:36.0875340+09:00)

- All three focused workflow-definition suites pass 3/3.
- The versioned-command suite is 55 lines, the catalog-action-contract suite
  is 42 lines, and the HTTP-write-contract suite is 40 lines; the mixed root
  suite is absent.

### Final verification (2026-09-03T19:12:00.2151394+09:00)

- The focused workflow-definition suites remain green at 3/3.
- Core tests passed with 277 files, 717 passed, and 3 skipped; core eval
  passed 11/11; document-engine passed 39/39; desktop typecheck/build,
  architecture (1035 modules, 3452 dependencies), and `git diff --check`
  passed.
- No production code changed; the mixed workflow-definition suite was split
  into three bounded test modules.

## Current structural task: command catalog test split (phase 234)

Split `agent/commands/service/catalog.test.ts` into focused command-contract,
HTTP-list redaction, and command-lifecycle metadata test modules. Preserve every
command name, lifecycle, mutation flag, saved endpoint, auth readiness field,
sanitized URL, credential redaction assertion, context, and response assertion;
this is a test-organization-only change.

### Success criteria

- `agent/commands/service/catalog/contract.test.ts` contains bounded command
  contract coverage and is <= 50 lines.
- `agent/commands/service/catalog/http-list.test.ts` contains saved HTTP
  endpoint selection metadata and credential redaction coverage and is <= 95
  lines.
- `agent/commands/service/catalog/lifecycle.test.ts` contains command lifecycle
  metadata coverage and is <= 45 lines.
- The previous mixed `agent/commands/service/catalog.test.ts` is absent; all
  three existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing command catalog contents, mutation flags, lifecycle values, HTTP
  endpoint selection metadata, auth readiness, URL sanitization, credential
  redaction, context handling, fixtures, assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T18:59:04.0890582+09:00)

- `agent/commands/service/catalog.test.ts` is 130 lines and combines command
  contract, HTTP endpoint redaction, and lifecycle metadata scenarios; the
  focused command-catalog test directory is absent.
- The existing command catalog suite passes 3/3. Core typecheck, tests,
  evaluation, document-engine 39/39, desktop typecheck/build, architecture,
  and whitespace checks pass.

### Focused verification (2026-09-03T19:02:42.3142172+09:00)

- The mixed original suite is absent. `contract.test.ts` is 28 lines,
  `http-list.test.ts` is 89 lines, and `lifecycle.test.ts` is 21 lines.
- The focused command catalog suites pass all three existing scenarios (3/3).

### Final verification (2026-09-03T19:04:46.1665443+09:00)

- Core typecheck passed; 275 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (1033 modules, 3444 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: HTTP response-limit test split (phase 233)

Split `modules/http/request/response-limits/limits.test.ts` into focused
streaming, content-length preflight, default-limit normalization, and
truncation-safety test modules. Preserve every fetch stub, stream chunk,
`maxBytes` input, response body, truncation flag, cancellation assertion, and
UTF-8 result; this is a test-organization-only change.

### Success criteria

- `modules/http/request/response-limits/streaming.test.ts` contains streamed
  response body limiting and is <= 50 lines.
- `modules/http/request/response-limits/content-length.test.ts` contains
  oversized content-length preflight handling and is <= 50 lines.
- `modules/http/request/response-limits/default-limit.test.ts` contains all
  invalid `maxBytes` default-limit cases and is <= 50 lines.
- `modules/http/request/response-limits/truncation-safety.test.ts` contains
  cancellation-failure and UTF-8 truncation safety and is <= 50 lines.
- The previous mixed `modules/http/request/response-limits/limits.test.ts` is
  absent; all five existing test blocks and eight generated cases remain
  covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing HTTP response streaming, max-byte normalization, content-length
  preflight, reader cancellation, UTF-8 truncation, fetch stubs, response
  bodies, flags, assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T18:53:57.6836832+09:00)

- `modules/http/request/response-limits/limits.test.ts` is 124 lines and
  combines streamed limits, content-length preflight, invalid-limit defaults,
  and truncation safety; the focused response-limit modules are absent.
- The existing mixed suite passes 8/8 generated cases. Core typecheck, tests,
  evaluation, document-engine 39/39, desktop typecheck/build, architecture,
  and whitespace checks pass.

### Focused verification (2026-09-03T18:56:26.9633227+09:00)

- The mixed original suite is absent. `streaming.test.ts` is 36 lines,
  `content-length.test.ts` is 33 lines, `default-limit.test.ts` is 32 lines,
  and `truncation-safety.test.ts` is 47 lines.
- The focused HTTP response-limit suites pass all eight generated cases (8/8).

### Final verification (2026-09-03T18:59:04.0890582+09:00)

- Core typecheck passed; 273 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (1031 modules, 3438 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: capability graph and cron test split (phase 232)

Split `catalog/capability-graph.test.ts` into focused capability availability,
alias resolution, dynamic catalog, and cron matching test modules. Preserve
every connected-state expectation, design capability, alias, dynamic
registration cleanup, trigger capability, date, timezone, and cron assertion;
this is a test-organization-only change.

### Success criteria

- `catalog/capability-graph/availability.test.ts` contains connected versus
  disconnected capability visibility scenarios and is <= 35 lines.
- `catalog/capability-graph/alias-resolution.test.ts` contains Gmail/Slack
  alias resolution scenarios and is <= 35 lines.
- `catalog/capability-graph/dynamic-catalog.test.ts` contains dynamic
  registration and ambiguous suffix protection scenarios and is <= 65 lines.
- `catalog/cron.test.ts` contains all cron matching scenarios and is <= 40
  lines.
- The previous mixed `catalog/capability-graph.test.ts` is absent; all ten
  existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing capability availability, design visibility, alias resolution,
  dynamic catalog cleanup, trigger IDs, cron parsing, timezone handling,
  fixtures, dates, assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T18:48:10.3437575+09:00)

- `catalog/capability-graph.test.ts` is 124 lines and combines six capability
  graph scenarios with four unrelated cron matching scenarios; the focused
  capability-graph and cron test modules are absent.
- The existing mixed suite passes 10/10. Core typecheck, tests, evaluation,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks pass.

### Focused verification (2026-09-03T18:52:03.9427685+09:00)

- The mixed original suite is absent. `availability.test.ts` is 20 lines,
  `alias-resolution.test.ts` is 17 lines, `dynamic-catalog.test.ts` is 65
  lines, and `cron.test.ts` is 27 lines.
- The focused capability graph and cron suites pass all ten existing scenarios
  (10/10).

### Final verification (2026-09-03T18:53:57.6836832+09:00)

- Core typecheck passed; 270 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (1028 modules, 3435 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: control-flow traversal test split (phase 231)

Split `runtime/engine/control-flow/traversal.test.ts` into focused normal
branch completion and nested risk-branch traversal test modules. Preserve every
workflow IR branch, condition, step id, connector action, AI decision schema,
binding, persisted log assertion, and message-order assertion; this is a
test-organization-only change.

### Success criteria

- `runtime/engine/control-flow/normal-completion.test.ts` contains the normal
  branch outer-step de-duplication scenario and is <= 60 lines.
- `runtime/engine/control-flow/nested-risk-branch.test.ts` contains the
  three-level risk branch and declared-result binding scenario and is <= 90
  lines.
- The previous mixed `runtime/engine/control-flow/traversal.test.ts` is
  absent; both existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing control-flow traversal, branch conditions, outer-step execution,
  AI decision output binding, connector actions, persisted logs, fixtures,
  assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T18:43:44.1551344+09:00)

- `runtime/engine/control-flow/traversal.test.ts` is 130 lines and combines
  normal branch completion with a nested risk-level branch and output binding;
  the focused traversal modules are absent.
- The existing control-flow traversal suite passes 2/2. Core typecheck, tests,
  evaluation, document-engine 39/39, desktop typecheck/build, architecture,
  and whitespace checks pass.

### Focused verification (2026-09-03T18:46:21.7798920+09:00)

- The mixed original suite is absent. `normal-completion.test.ts` is 55 lines
  and `nested-risk-branch.test.ts` is 83 lines.
- The focused control-flow traversal suites pass both existing scenarios (2/2).

### Final verification (2026-09-03T18:48:10.3437575+09:00)

- Core typecheck passed; 267 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (1025 modules, 3433 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: corrupt approval continuation test split (phase 230)

Split `runtime/engine/approval/corrupt-state/snapshot-state.test.ts` into
focused orphan-execution, execution-snapshot validation, and execution-log
validation test modules. Preserve every database mutation, approval row,
execution snapshot, persisted log payload, error code, approval status,
execution status, callback result, and cleanup assertion; this is a
test-organization-only change.

### Success criteria

- `runtime/engine/approval/corrupt-state/orphan-execution.test.ts` contains
  the deleted-execution approval scenario and is <= 35 lines.
- `runtime/engine/approval/corrupt-state/execution-snapshot.test.ts` contains
  corrupted and absent snapshot scenarios and is <= 60 lines.
- `runtime/engine/approval/corrupt-state/execution-log.test.ts` contains
  malformed and invalid-shape persisted log scenarios and is <= 65 lines.
- The previous mixed `runtime/engine/approval/corrupt-state/snapshot-state.test.ts`
  is absent; all five existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing approval continuation fail-closed behavior, foreign-key setup,
  snapshot parsing, persisted log parsing, error codes, approval/execution
  status updates, callbacks, fixtures, database mutations, assertions, or
  production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T18:39:20.5887730+09:00)

- `runtime/engine/approval/corrupt-state/snapshot-state.test.ts` is 131 lines
  and combines orphan execution, execution snapshot, and persisted log
  corruption scenarios; the focused corrupt-state test modules are absent.
- The existing corrupt approval continuation suite passes 5/5. Core typecheck,
  tests, evaluation, document-engine 39/39, desktop typecheck/build,
  architecture, and whitespace checks pass.

### Focused verification (2026-09-03T18:41:51.5644964+09:00)

- The mixed original suite is absent. `orphan-execution.test.ts` is 31 lines,
  `execution-snapshot.test.ts` is 59 lines, and `execution-log.test.ts` is 55
  lines.
- The focused corrupt approval continuation suites pass all five existing
  scenarios (5/5).

### Final verification (2026-09-03T18:43:44.1551344+09:00)

- Core typecheck passed; 266 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (1024 modules, 3428 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: ArtifactStore test split (phase 229)

Split `store/artifact-store.test.ts` into focused content/deduplication,
metadata/JSON, and path-safety test modules. Preserve every temporary store
fixture, byte payload, metadata file, artifact ID, hash, filename, stored path,
JSON value, rejection message, and filesystem safety assertion; this is a
test-organization-only change.

### Success criteria

- `store/artifact/content-dedup.test.ts` contains import/byte persistence,
  sha256 deduplication, and conflicting-ID coverage and is <= 65 lines.
- `store/artifact/metadata-and-json.test.ts` contains corrupt/unrelated
  metadata and JSON artifact coverage and is <= 60 lines.
- `store/artifact/path-safety.test.ts` contains artifact-ID and outside-file
  metadata safety coverage and is <= 65 lines.
- The previous mixed `store/artifact-store.test.ts` is absent; all eight
  existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing ArtifactStore persistence, sha256 deduplication, filename
  sanitization, metadata parsing, JSON sidecars, artifact-ID validation,
  root-containment checks, fixtures, rejection messages, assertions, or
  production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T18:34:55.7136276+09:00)

- `store/artifact-store.test.ts` is 131 lines and combines content
  deduplication, metadata/JSON handling, and path-safety behavior; the focused
  ArtifactStore test directory is absent.
- The existing ArtifactStore suite passes 8/8. Core typecheck, tests,
  evaluation, document-engine 39/39, desktop typecheck/build, architecture,
  and whitespace checks pass.

### Focused verification (2026-09-03T18:37:32.8436599+09:00)

- The mixed original suite is absent. `content-dedup.test.ts` is 54 lines,
  `metadata-and-json.test.ts` is 40 lines, and `path-safety.test.ts` is 51
  lines.
- The focused ArtifactStore suites pass all eight existing scenarios (8/8).

### Final verification (2026-09-03T18:39:20.5887730+09:00)

- Core typecheck passed; 264 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (1022 modules, 3420 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: source resolver boundary test split (phase 228)

Split `runtime/source-resolver.test.ts` into focused connected-file-ref,
path-boundary, and missing-file boundary test modules. Preserve every temporary
folder/file fixture, connection shape, source/folder metadata, resolved path,
error code, and success/failure assertion; this is a test-organization-only
change.

### Success criteria

- `runtime/source-resolver/file-ref.test.ts` contains the connected-folder
  FileRef resolution scenario and is <= 40 lines.
- `runtime/source-resolver/path-boundary.test.ts` contains outside-path and
  unavailable-folder path-boundary scenarios and is <= 70 lines.
- `runtime/source-resolver/missing-file.test.ts` contains missing-file error
  scenarios for one and multiple roots and is <= 65 lines.
- The previous mixed `runtime/source-resolver.test.ts` is absent; all five
  existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing source resolution, connected-folder containment, missing-file error
  classification, unavailable-root handling, fixtures, connection metadata,
  error codes, assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T18:30:27.6750315+09:00)

- `runtime/source-resolver.test.ts` is 131 lines and combines connected
  FileRef resolution with path-boundary and missing-file error behavior; the
  focused source-resolver test directory is absent.
- The existing source-resolver suite passes 5/5. Core typecheck, tests,
  evaluation, document-engine 39/39, desktop typecheck/build, architecture,
  and whitespace checks pass.

### Focused verification (2026-09-03T18:33:04.4686443+09:00)

- The mixed original suite is absent. `file-ref.test.ts` is 38 lines,
  `path-boundary.test.ts` is 56 lines, and `missing-file.test.ts` is 51 lines.
- The focused source-resolver suites pass all five existing scenarios (5/5).

### Final verification (2026-09-03T18:34:55.7136276+09:00)

- Core typecheck passed; 262 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (1020 modules, 3412 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: approval continuation success-flow test split (phase 227)

Split `runtime/engine/approval/continuation/basic.test.ts` into focused direct
approval continuation and conditional-branch continuation test modules.
Preserve every workflow IR step, approval state, execution persistence check,
connector mock, concurrency assertion, branch traversal assertion, and side
effect assertion; this is a test-organization-only change.

### Success criteria

- `runtime/engine/approval/continuation/direct-resume.test.ts` contains the
  direct approval, duplicate continuation, and post-approval side-effect
  scenario and is <= 75 lines.
- `runtime/engine/approval/continuation/branch-resume.test.ts` contains the
  approval-inside-if branch and outer-tail continuation scenario and is <= 75
  lines.
- The previous mixed `runtime/engine/approval/continuation/basic.test.ts` is
  absent; both existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing approval continuation, pending state persistence, duplicate approval
  handling, branch traversal, connector behavior, workflow fixtures, side
  effects, assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T18:26:12.5102924+09:00)

- `runtime/engine/approval/continuation/basic.test.ts` is 136 lines and
  combines direct approval continuation with approval inside an `if` branch;
  the focused continuation modules are absent.
- The existing approval continuation suite passes 2/2. Core typecheck, tests,
  evaluation, document-engine 39/39, desktop typecheck/build, architecture,
  and whitespace checks pass.

### Focused verification (2026-09-03T18:28:39.9104933+09:00)

- The mixed original suite is absent. `direct-resume.test.ts` is 69 lines and
  `branch-resume.test.ts` is 75 lines.
- The focused approval continuation suites pass both existing scenarios (2/2).

### Final verification (2026-09-03T18:30:27.6750315+09:00)

- Core typecheck passed; 260 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (1018 modules, 3404 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: Gmail history polling test split (phase 226)

Split `modules/gmail/new-message-poll/history.test.ts` into focused history
pagination/deduplication and page-token cycle-guard test modules. Preserve every
Gmail mock response, request argument, message fixture, cursor value, event
assertion, and call-count assertion; this is a test-organization-only change.

### Success criteria

- `modules/gmail/new-message-poll/history/pagination.test.ts` contains
  multi-page history and duplicate-message handling and is <= 75 lines.
- `modules/gmail/new-message-poll/history/cycle-guard.test.ts` contains
  history page-token cycle protection and collected-message preservation and is
  <= 70 lines.
- The previous mixed `modules/gmail/new-message-poll/history.test.ts` is
  absent; both existing scenarios remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing Gmail history pagination, page-token cycle handling, message
  deduplication, cursor persistence, API request arguments, fixtures,
  assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T18:22:01.2556399+09:00)

- `modules/gmail/new-message-poll/history.test.ts` is 137 lines and combines
  multi-page history/deduplication with page-token cycle protection; the
  focused history test directory is absent.
- The existing Gmail history suite passes 2/2. Core typecheck, tests,
  evaluation, document-engine 39/39, desktop typecheck/build, architecture,
  and whitespace checks pass.

### Focused verification (2026-09-03T18:24:23.9531032+09:00)

- The mixed original suite is absent. `pagination.test.ts` is 75 lines and
  `cycle-guard.test.ts` is 67 lines.
- The focused Gmail history suites pass both existing scenarios (2/2).

### Final verification (2026-09-03T18:26:12.5102924+09:00)

- Core typecheck passed; 259 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (1017 modules, 3399 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: webhook listener rejection test split (phase 225)

Split `triggers/webhook/listener/rejection.test.ts` into focused path/secret
rejection and payload-size boundary test modules. Preserve every listener
lifecycle hook, request method/path, port, secret, body, event assertion, and
HTTP response assertion; this is a test-organization-only change.

### Success criteria

- `triggers/webhook/listener/rejection/path-and-secret.test.ts` contains
  malformed-path, rejected-body drain, and invalid-secret coverage and is
  <= 65 lines.
- `triggers/webhook/listener/rejection/payload-size.test.ts` contains
  oversized-body, oversized-declared-length, and exact-limit coverage and is
  <= 75 lines.
- The previous mixed `triggers/webhook/listener/rejection.test.ts` is absent;
  all six existing test blocks and eight generated request cases remain
  covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing webhook listener routing, URL decoding, request draining, secret
  validation, payload limits, event emission, lifecycle cleanup, fixtures,
  ports, assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T18:14:56.7401202+09:00)

- `triggers/webhook/listener/rejection.test.ts` is 134 lines and combines
  path/method/secret rejection with payload-size boundary behavior; the
  focused rejection test directory is absent.
- The existing webhook rejection suite passes 8/8 generated cases. Core
  typecheck, tests, evaluation, document-engine 39/39, desktop typecheck/build,
  architecture, and whitespace checks pass.

### Focused verification (2026-09-03T18:20:09.4620558+09:00)

- The mixed original suite is absent. `path-and-secret.test.ts` is 62 lines
  and `payload-size.test.ts` is 74 lines.
- The focused webhook rejection suites pass all eight generated request cases
  (8/8).

### Final verification (2026-09-03T18:22:01.2556399+09:00)

- Core typecheck passed; 258 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (1016 modules, 3398 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: manual-run-input folder-selection test split (phase 224)

Split `runtime/manual-run-input/folder-selection.test.ts` into focused
single-folder resolution, path/selection guard, and extension guard test
modules. Preserve every filesystem fixture, connection setup, workflow input,
fallback rule, ambiguity guard, and assertion; this is a test-organization-only
change.

### Success criteria

- `runtime/manual-run-input/folder-selection/single-folder-resolution.test.ts`
  contains the direct, stale-id fallback, and manual-ingest resolution
  scenarios and is <= 75 lines.
- `runtime/manual-run-input/folder-selection/path-and-selection-guards.test.ts`
  contains concrete-path, multiple-folder ambiguity, and explicitly-empty
  folder guard scenarios and is <= 75 lines.
- `runtime/manual-run-input/folder-selection/extension-guard.test.ts`
  contains the trigger-extension guard scenario and is <= 35 lines.
- The previous mixed `runtime/manual-run-input/folder-selection.test.ts` is
  absent; all seven existing scenario blocks remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing manual-run input construction, folder resolution, stale-id fallback,
  ambiguity handling, extension filtering, fixtures, assertions, or production
  imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T18:08:40.5113777+09:00)

- `runtime/manual-run-input/folder-selection.test.ts` is 137 lines and
  combines seven folder resolution and guard scenarios; the focused folder
  selection test directory is absent.
- The existing folder-selection suite passes 7/7. Core typecheck, tests,
  evaluation, document-engine 39/39, desktop typecheck/build, architecture,
  and whitespace checks pass.

### Focused verification (2026-09-03T18:12:51.2972584+09:00)

- The mixed original suite is absent. `single-folder-resolution.test.ts` is
  59 lines, `path-and-selection-guards.test.ts` is 71 lines, and
  `extension-guard.test.ts` is 27 lines.
- The focused manual-run folder-selection suites pass all seven existing
  scenarios (7/7).

### Final verification (2026-09-03T18:14:56.7401202+09:00)

- Core typecheck passed; 257 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (1015 modules, 3396 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: job.propose target-selection test split (phase 223)

Split `agent/commands/job-registration/targets.test.ts` into focused required
input, discovery-options, and discovery-fallback test modules. Preserve every
service, connection, gateway, context, presentation, option, issue, and
persistence assertion; this is a test-organization-only change.

### Success criteria

- `agent/commands/job-registration/targets/required-input.test.ts` contains
  the Slack channel required-input scenario and is <= 40 lines.
- `agent/commands/job-registration/targets/discovery-options.test.ts` contains
  HTTP/Slack discovery and option-card coverage and is <= 85 lines.
- `agent/commands/job-registration/targets/discovery-fallback.test.ts` contains
  Slack discovery failure fallback coverage and is <= 50 lines.
- The previous mixed `agent/commands/job-registration/targets.test.ts` is
  absent; all three existing scenario blocks remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing job target selection, connection discovery, Slack channel discovery,
  fallback presentation, persistence guards, fixtures, assertions, or
  production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T18:02:12.6039916+09:00)

- `agent/commands/job-registration/targets.test.ts` is 138 lines and combines
  required-input presentation, populated HTTP/Slack discovery options, and
  discovery-failure fallback; the focused target-selection test directory is
  absent.
- The existing job target-selection suite passes 3/3. Core typecheck, tests,
  evaluation, document-engine 39/39, desktop typecheck/build, architecture,
  and whitespace checks pass.

### Focused verification (2026-09-03T18:04:20.0032559+09:00)

- The mixed original suite is absent. `required-input.test.ts` is 32 lines,
  `discovery-options.test.ts` is 74 lines, and `discovery-fallback.test.ts` is
  42 lines.
- The focused job target-selection suites pass all three existing scenarios
  (3/3).

### Final verification (2026-09-03T18:08:40.5113777+09:00)

- Core typecheck passed; 255 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (1013 modules, 3382 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: command read-gateway test split (phase 222)

Split `agent/commands/service/reads.test.ts` into focused capability-list,
error-boundary, and gateway-routing test modules. Preserve every database,
service, gateway, context, response, redaction, and routing assertion; this is
a test-organization-only change.

### Success criteria

- `agent/commands/service/reads/capability-list.test.ts` contains capability
  discovery coverage and is <= 35 lines.
- `agent/commands/service/reads/error-boundary.test.ts` contains bounded error
  detail and provider-detail redaction coverage and is <= 85 lines.
- `agent/commands/service/reads/gateway-routing.test.ts` contains workflow-only
  versus source gateway routing coverage and is <= 45 lines.
- The previous mixed `agent/commands/service/reads.test.ts` is absent; all four
  existing scenario blocks remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing command read gateways, capability discovery, error detail bounds,
  redaction, context construction, routing, fixtures, assertions, or production
  imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T17:55:36.1115935+09:00)

- `agent/commands/service/reads.test.ts` is 138 lines and combines capability
  discovery, bounded provider-error details, and workflow/source gateway
  routing; the focused read-gateway test directory is absent.
- The existing command read-gateway suite passes 4/4. Core typecheck, tests,
  evaluation, document-engine 39/39, desktop typecheck/build, architecture,
  and whitespace checks pass.

### Focused verification (2026-09-03T17:57:12.3896607+09:00)

- The mixed original suite is absent. `capability-list.test.ts` is 25 lines,
  `error-boundary.test.ts` is 83 lines, and `gateway-routing.test.ts` is 39
  lines.
- The focused command read-gateway suites pass all four existing scenarios
  (4/4).

### Final verification (2026-09-03T17:58:57.9067402+09:00)

- Core typecheck passed; 253 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (1011 modules, 3378 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: evaluation test domain split (phase 221)

Split `eval/eval.test.ts` into focused Workflow IR, WorkflowStore, requiredness,
runtime, and scenario-catalog test modules. Preserve every fixture, database
setup, runtime input, scenario file, assertion, and evaluation behavior; this
is a test-organization-only change.

### Success criteria

- `eval/eval/workflow-ir.test.ts` contains Workflow IR validation, approval,
  and deployability scenarios and is <= 55 lines.
- `eval/eval/workflow-store.test.ts` contains WorkflowStore CRUD coverage and
  is <= 30 lines.
- `eval/eval/requiredness.test.ts` contains required-slot coverage and is <= 45
  lines.
- `eval/eval/runtime.test.ts` contains valid CS notification execution coverage
  and is <= 55 lines.
- `eval/eval/scenario-catalog.test.ts` contains scenario-file required-slot
  coverage and is <= 55 lines.
- The previous mixed `eval/eval.test.ts` is absent; all eleven existing
  evaluation scenarios remain covered exactly once across the focused suites.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing evaluation criteria, Workflow IR validation, approval policy,
  deployability, store persistence, requiredness, runtime execution, scenario
  catalog, fixtures, assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T17:46:59.4451680+09:00)

- `eval/eval.test.ts` is 138 lines and combines Workflow IR, WorkflowStore,
  requiredness, runtime, and scenario-catalog coverage; the focused evaluation
  test directory is absent.
- The existing evaluation suite passes 11/11. Core typecheck, tests,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks pass.

### Focused verification attempt (2026-09-03T17:48:35.2977718+09:00)

- All five extracted modules satisfied their line limits and the mixed original
  suite was absent.
- The verification script stopped before Vitest because it double-counted the
  JSON-driven loop when checking the expected eleven scenarios; no scenario
  execution occurred in this attempt.

### Focused verification (2026-09-03T17:49:36.6907034+09:00)

- The mixed original suite is absent. `workflow-ir.test.ts` is 23 lines,
  `workflow-store.test.ts` is 16 lines, `requiredness.test.ts` is 32 lines,
  `runtime.test.ts` is 41 lines, and `scenario-catalog.test.ts` is 35 lines.
- The focused evaluation suites pass all eleven generated scenarios (11/11).

### Final verification (2026-09-03T17:52:09.5247582+09:00)

- Core typecheck passed; 251 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (1009 modules, 3371 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: job.propose input-validation test split (phase 220)

Split `agent/commands/job-registration/input-validation.test.ts` into focused
normalization/success, schedule-and-connection validation, and malformed-input
protection test modules. Preserve every service fixture, request argument,
response assertion, persistence check, and runtime behavior; this is a
test-organization-only change.

### Success criteria

- `agent/commands/job-registration/input-validation/success.test.ts` contains
  confirm-card, compact-field, and alias/boolean normalization scenarios and is
  <= 115 lines.
- `agent/commands/job-registration/input-validation/schedule-and-connection.test.ts`
  contains invalid-timezone and unknown-connection scenarios and is <= 75
  lines.
- `agent/commands/job-registration/input-validation/malformed-input.test.ts`
  contains unusable-argument protection coverage and is <= 35 lines.
- The previous mixed `agent/commands/job-registration/input-validation.test.ts`
  is absent; all six existing scenario blocks remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing job proposal normalization, schedule validation, connection lookup,
  malformed-input handling, service fixtures, request arguments, response
  shapes, persistence checks, assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T17:39:16.4505751+09:00)

- `agent/commands/job-registration/input-validation.test.ts` is 139 lines and
  combines successful normalization, schedule/connection rejection, and
  malformed-input protection; the focused input-validation directory is
  absent.
- The existing `job.propose` input-validation suite passes 6/6. Core
  typecheck, tests, evaluation, document-engine 39/39, desktop typecheck/build,
  architecture, and whitespace checks pass.

### Focused verification (2026-09-03T17:40:51.1222655+09:00)

- The mixed original suite is absent. `success.test.ts` is 81 lines,
  `schedule-and-connection.test.ts` is 49 lines, and
  `malformed-input.test.ts` is 16 lines.
- The focused job proposal input-validation suites pass all six existing
  scenarios (6/6).

### Final verification (2026-09-03T17:43:20.5137300+09:00)

- Core typecheck passed; 251 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (1005 modules, 3366 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: PDF generation test boundary split (phase 219)

Split `modules/document/write/pdf/generate.test.ts` into focused successful
artifact generation and failure-mode test modules. Preserve every print bridge,
artifact store, input, result, variable, log, error, and cleanup assertion;
this is a test-organization-only change.

### Success criteria

- `modules/document/write/pdf/success.test.ts` contains successful PDF byte
  persistence and safe artifact-reference coverage and is <= 105 lines.
- `modules/document/write/pdf/failure-modes.test.ts` contains unavailable-store,
  unavailable-print-bridge, and post-print-storage-failure coverage and is <=
  75 lines.
- The previous mixed `modules/document/write/pdf/generate.test.ts` is absent;
  all four existing scenario blocks remain covered exactly once across the
  focused suites.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing PDF generation, desktop print bridging, artifact persistence,
  reference redaction, result variables, logging, error codes, fixtures,
  assertions, cleanup, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T17:31:37.6336701+09:00)

- `modules/document/write/pdf/generate.test.ts` is 142 lines and combines
  successful safe-artifact persistence with unavailable-store,
  unavailable-bridge, and post-print-storage failure scenarios; the focused
  test modules are absent.
- The existing PDF generation suite passes 4/4. Core typecheck, tests,
  evaluation, document-engine 39/39, desktop typecheck/build, architecture,
  and whitespace checks pass.

### Focused verification (2026-09-03T17:33:18.8332935+09:00)

- The mixed original suite is absent. `success.test.ts` is 96 lines and
  `failure-modes.test.ts` is 70 lines.
- The focused PDF generation suites pass all four existing scenarios (4/4).

### Final verification (2026-09-03T17:35:57.3907933+09:00)

- Core typecheck passed; 249 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (1003 modules, 3364 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: bootstrap completion projection test split (phase 218)

Split `bootstrap.test.ts` into saved-run, queued one-shot, and pending-approval
projection test modules. Preserve every temporary data root, core setup,
workflow/action fixture, event payload, chat message assertion, cleanup, and
runtime behavior; this is a test-organization-only change.

### Success criteria

- `bootstrap/saved-run.test.ts` contains saved manual-run completion projection
  coverage and is <= 55 lines.
- `bootstrap/queued-result.test.ts` contains queued one-shot completion
  projection coverage and is <= 55 lines.
- `bootstrap/pending-approval.test.ts` contains pending one-shot approval
  projection coverage and is <= 65 lines.
- The previous mixed `bootstrap.test.ts` is absent; all three existing
  scenario blocks remain covered exactly once across the focused suites.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing bootstrap wiring, completion projection, one-shot execution,
  approval behavior, event payloads, persistence, fixtures, assertions,
  cleanup, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T17:23:24.5417661+09:00)

- `bootstrap.test.ts` is 143 lines and combines saved manual-run completion,
  queued one-shot completion, and pending-approval projection; the focused
  bootstrap test directory is absent.
- The existing bootstrap completion projection suite passes 3/3. Core
  typecheck, tests, evaluation, document-engine 39/39, desktop typecheck/build,
  architecture, and whitespace checks pass.

### Focused verification (2026-09-03T17:24:56.3409948+09:00)

- The mixed original suite is absent. `saved-run.test.ts` is 49 lines,
  `queued-result.test.ts` is 43 lines, and `pending-approval.test.ts` is 65
  lines.
- The focused bootstrap projection suites pass all three existing scenarios
  (3/3).

### Final verification (2026-09-03T17:28:09.2185139+09:00)

- Core typecheck passed; 248 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (1002 modules, 3361 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: persisted workflow document test split (phase 217)

Split `workflow/persisted-document.test.ts` into focused action-storage,
round-trip, and HTTP-reload test modules. Preserve every workflow fixture,
stored-document value, assertion, and persistence/side-effect behavior; this
is a test-organization-only change.

### Success criteria

- `workflow/persisted-document/action-storage.test.ts` contains action-map
  serialization and unknown-capability rejection scenarios and is <= 75 lines.
- `workflow/persisted-document/round-trip.test.ts` contains stored-document
  round-trip restoration coverage and is <= 55 lines.
- `workflow/persisted-document/http-reload.test.ts` contains HTTP GET side-effect
  restoration coverage and is <= 45 lines.
- The previous mixed `workflow/persisted-document.test.ts` is absent; all four
  existing scenario blocks remain covered exactly once across the focused
  suites.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing workflow document format, action-map serialization, capability
  validation, round-trip restoration, HTTP side-effect classification, schema
  parsing, fixtures, assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T17:15:07.7088225+09:00)

- `workflow/persisted-document.test.ts` is 138 lines and combines action
  storage/catalog validation, stored-document round-trip restoration, and HTTP
  GET side-effect reload behavior; the focused test directory is absent.
- The existing persisted workflow document suite passes 4/4. Core typecheck,
  tests, evaluation, document-engine 39/39, desktop typecheck/build,
  architecture, and whitespace checks pass.

### Focused verification attempt (2026-09-03T17:16:42.3338645+09:00)

- The three extracted modules measured 64, 50, and 33 lines, all within their
  declared limits, and the mixed original suite was absent.
- The verification script stopped before Vitest because its Windows `rg`
  wildcard path was invalid; no scenario execution occurred in this attempt.

### Focused verification (2026-09-03T17:17:26.2991737+09:00)

- The mixed original suite is absent. `action-storage.test.ts` is 64 lines,
  `round-trip.test.ts` is 50 lines, and `http-reload.test.ts` is 33 lines.
- The focused persisted workflow document suites pass all four existing
  scenarios (4/4).

### Final verification (2026-09-03T17:19:06.6442492+09:00)

- Core typecheck passed; 246 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (1000 modules, 3353 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: Slack format-message test split (phase 216)

Split `modules/slack/format-message.test.ts` into focused Markdown/section,
Block Kit/source-footer, and payload test modules. Preserve every formatter
input, shared context value, expected block/payload shape, source metadata,
assertion, and data value; this is a test-organization-only change.

### Success criteria

- `modules/slack/format-message/markdown.test.ts` contains the four Markdown
  conversion and section-parsing scenarios and is <= 55 lines.
- `modules/slack/format-message/blocks-and-source.test.ts` contains the four
  Block Kit and source-footer scenarios and is <= 75 lines.
- `modules/slack/format-message/payload.test.ts` contains the two payload
  rendering/fallback scenarios and is <= 65 lines.
- The previous mixed `modules/slack/format-message.test.ts` is absent; all ten
  existing scenario blocks remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing Markdown conversion, section parsing, Block Kit construction,
  source resolution, payload fallback, shared context, assertions, or
  production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T17:05:40.9908166+09:00)

- `modules/slack/format-message.test.ts` is 143 lines and combines ten
  Markdown, section, Block Kit, source-footer, and payload scenarios; the
  focused format-message test modules are absent.
- The existing Slack format-message suite passes 10/10. Core typecheck/tests,
  evaluation, document-engine 39/39, desktop typecheck/build, architecture,
  and whitespace checks pass.

### Focused verification (2026-09-03T17:07:00.2692283+09:00)

- The mixed original suite is absent. `markdown.test.ts` is 30 lines,
  `blocks-and-source.test.ts` is 70 lines, and `payload.test.ts` is 54 lines.
- The focused Slack format-message suites pass all ten existing scenarios
  (10/10).

### Final verification (2026-09-03T17:08:38.4948491+09:00)

- Core typecheck passed; 244 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (998 modules, 3349 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: Work Discovery service test split (phase 215)

Split `work-discovery/service.test.ts` into focused lifecycle operation and
revision-conflict test modules. Preserve every test body, temporary-directory
setup, in-memory database state, service construction, blueprint data, gateway
request, assertion, cleanup, and data value; this is a test-organization-only
change.

### Success criteria

- `work-discovery/service/operations.test.ts` contains the cancellation and
  recurrence scenarios and is <= 65 lines.
- `work-discovery/service/revision-conflicts.test.ts` contains the four stale
  answer/publish, idempotent publish, and gateway-conflict scenarios and is <=
  115 lines.
- The previous mixed `work-discovery/service.test.ts` is absent; all six
  existing scenario blocks remain covered exactly once across the focused
  suites.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing Work Discovery lifecycle operations, revision conflict handling,
  publish idempotency, gateway behavior, fixtures, persistence, assertions,
  cleanup, or production imports.
- Refactoring the existing recovery tests, unrelated tests, or existing dirty
  worktree changes.

### Baseline (2026-09-03T16:59:52.7213787+09:00)

- `work-discovery/service.test.ts` is 144 lines and combines six lifecycle,
  revision-conflict, publish-idempotency, and gateway-conflict scenarios; the
  focused operations/conflict modules are absent.
- The existing Work Discovery service suite passes 6/6. Core typecheck/tests,
  evaluation, document-engine 39/39, desktop typecheck/build, architecture,
  and whitespace checks pass.

### Focused verification (2026-09-03T17:01:17.0197461+09:00)

- The mixed original suite is absent. `operations.test.ts` is 56 lines and
  `revision-conflicts.test.ts` is 95 lines.
- The focused Work Discovery service suites pass all six existing scenarios
  (6/6).

### Final verification (2026-09-03T17:02:53.4711813+09:00)

- Core typecheck passed; 242 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (996 modules, 3347 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: condition normalization test split (phase 214)

Split `runtime/condition-eval/normalization.test.ts` into focused legacy and
composite condition, interview-input shape, and invalid-input safety test
modules. Preserve every normalization input, expected condition shape,
preprocessing assertion, and data value; this is a test-organization-only
change.

### Success criteria

- `runtime/condition-eval/normalization/legacy-and-composite.test.ts` contains
  the three legacy/composite condition scenarios and is <= 60 lines.
- `runtime/condition-eval/normalization/interview-inputs.test.ts` contains the
  six interview-output condition-shape scenarios and is <= 100 lines.
- `runtime/condition-eval/normalization/invalid-input.test.ts` contains the
  invalid-filter safety scenario and is <= 25 lines.
- The previous mixed `runtime/condition-eval/normalization.test.ts` is absent;
  all ten existing scenario blocks remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing condition migration, normalization, coercion, preprocessing,
  operator aliases, invalid-input handling, expected shapes, or production
  imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T16:51:26.4980191+09:00)

- `condition-eval/normalization.test.ts` is 144 lines and combines ten
  legacy/composite, interview-input, and invalid-input scenarios; the focused
  normalization directory is absent.
- The existing condition normalization suite passes 10/10. Core
  typecheck/tests, evaluation, document-engine 39/39, desktop typecheck/build,
  architecture, and whitespace checks pass.

### Focused verification (after structure correction, 2026-09-03T16:53:28.4538171+09:00)

- The mixed original suite is absent. `legacy-and-composite.test.ts` is 42
  lines, `interview-inputs.test.ts` is 100 lines, and `invalid-input.test.ts`
  is 8 lines.
- The focused condition normalization suites pass all ten existing scenarios
  (10/10).

### Final verification (2026-09-03T16:56:02.4292991+09:00)

- Core typecheck passed; 241 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (995 modules, 3341 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: chat context test split (phase 213)

Split `agent/commands/chat/context.test.ts` into focused session-source
manifest, bounded context, and confirmed context-update test modules. Preserve
every AgentHarness/model setup, database state, source metadata, chat session,
presentation action, context policy, response assertion, and data value; this
is a test-organization-only change.

### Success criteria

- `agent/commands/chat/context/source-manifest.test.ts` contains the session
  source manifest isolation scenario and is <= 65 lines.
- `agent/commands/chat/context/bounded-context.test.ts` contains the
  soul/memo/workflow policy scenario and is <= 65 lines.
- `agent/commands/chat/context/confirmed-update.test.ts` contains the
  host-confirmed context persistence scenario and is <= 95 lines.
- The previous mixed `agent/commands/chat/context.test.ts` is absent; all three
  existing scenario blocks remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing source manifest filtering, system prompt context, memo/policy
  boundaries, host confirmation, context persistence, model sequencing,
  assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T16:45:35.8694671+09:00)

- `chat/context.test.ts` is 146 lines and combines three session-source,
  bounded-context, and confirmed-update scenarios; the focused context
  directory is absent.
- The existing chat context suite passes 3/3. Core typecheck/tests,
  evaluation, document-engine 39/39, desktop typecheck/build, architecture,
  and whitespace checks pass.

### Focused verification (2026-09-03T16:47:15.1288593+09:00)

- The mixed original suite is absent. `source-manifest.test.ts` is 50 lines,
  `bounded-context.test.ts` is 40 lines, and `confirmed-update.test.ts` is 75
  lines.
- The focused chat context suites pass all three existing scenarios (3/3).

### Final verification (2026-09-03T16:48:51.8874083+09:00)

- Core typecheck passed; 239 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (993 modules, 3339 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: Slack read test split (phase 212)

Split `modules/slack/slack-read.test.ts` into focused pagination/channel
resolution and capability invocation test modules. Preserve every mock,
pagination cursor, read limit, channel lookup, Slack connector setup,
capability context, response assertion, and data value; this is a
test-organization-only change.

### Success criteria

- `modules/slack/slack-read/pagination.test.ts` contains the six Slack
  listing/history/search limit and channel-resolution scenarios and is <= 105
  lines.
- `modules/slack/slack-read/capability-invocation.test.ts` contains the three
  Slack connector/capability invocation scenarios and is <= 75 lines.
- The previous mixed `modules/slack/slack-read.test.ts` is absent; all nine
  existing scenario blocks remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing Slack pagination, cursor handling, channel resolution, read limits,
  connector behavior, capability policy, mocks, assertions, or production
  imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T16:40:05.1806293+09:00)

- `modules/slack/slack-read.test.ts` is 146 lines and combines nine Slack
  pagination, channel-resolution, search-limit, connector, and capability
  policy scenarios; the focused Slack read directory is absent.
- The existing Slack read suite passes 9/9. Core typecheck/tests, evaluation,
  document-engine 39/39, desktop typecheck/build, architecture, and
  whitespace checks pass.

### Focused verification (2026-09-03T16:41:28.8797698+09:00)

- The mixed original suite is absent. `pagination.test.ts` is 92 lines and
  `capability-invocation.test.ts` is 57 lines.
- The focused Slack read suites pass all nine existing scenarios (9/9).

### Final verification (2026-09-03T16:43:03.4776872+09:00)

- Core typecheck passed; 237 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (991 modules, 3325 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: chat target-selection test split (phase 211)

Split `agent/commands/chat/target-selection.test.ts` into focused job-card and
one-shot-card test modules. Preserve every test body, AgentHarness setup,
scripted model sequence, database/connection setup, presentation capture,
session context, response assertion, and dynamic target data; this is a
test-organization-only change.

### Success criteria

- `agent/commands/chat/target-selection/job-card.test.ts` contains the
  `job.propose` target-card scenario and is <= 100 lines.
- `agent/commands/chat/target-selection/one-shot-card.test.ts` contains the
  `execution.enqueue_once` target-card scenario and is <= 100 lines.
- The previous mixed `agent/commands/chat/target-selection.test.ts` is absent;
  both existing scenario blocks remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing chat command behavior, AgentHarness/model sequencing, connection or
  Slack channel discovery, presentation fields, session context, assertions,
  or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T16:34:27.7885055+09:00)

- `chat/target-selection.test.ts` is 147 lines and combines two job and
  one-shot target-card scenarios; the focused target-selection directory is
  absent.
- The existing chat target-selection suite passes 2/2. Core typecheck/tests,
  evaluation, document-engine 39/39, desktop typecheck/build, architecture,
  and whitespace checks pass.

### Focused verification (2026-09-03T16:35:58.2007515+09:00)

- The mixed original suite is absent. `job-card.test.ts` is 73 lines and
  `one-shot-card.test.ts` is 83 lines.
- The focused chat target-selection suites pass both existing scenarios (2/2).

### Final verification (2026-09-03T16:37:32.6755129+09:00)

- Core typecheck passed; 236 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (990 modules, 3325 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: one-shot target-selection test split (phase 210)

Split `agent/commands/service/one-shot/target-selection.test.ts` into focused
chooser-card and selected-target queueing test modules. Preserve every test
body, in-memory database setup, connection catalog, read gateway response,
queue callback, chat context, response assertion, and target propagation; this
is a test-organization-only change.

### Success criteria

- `agent/commands/service/one-shot/chooser-card.test.ts` contains the target
  chooser-card scenario and is <= 100 lines.
- `agent/commands/service/one-shot/selected-targets.test.ts` contains the
  selected-target queueing scenario and is <= 90 lines.
- The previous mixed `agent/commands/service/one-shot/target-selection.test.ts`
  is absent; both existing scenario blocks remain covered exactly once.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing one-shot command behavior, target-card fields, connection or Slack
  channel discovery, queueing, session propagation, workflow parameters,
  assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T16:28:21.9709385+09:00)

- `one-shot/target-selection.test.ts` is 151 lines and combines two target
  selection/queueing scenarios; the focused chooser-card and selected-target
  suites are absent.
- The existing one-shot target-selection suite passes 2/2. Core typecheck/tests,
  evaluation, document-engine 39/39, desktop typecheck/build, architecture,
  and whitespace checks pass.

### Focused verification (2026-09-03T16:30:10.0969222+09:00)

- The mixed original suite is absent. `chooser-card.test.ts` is 88 lines and
  `selected-targets.test.ts` is 70 lines.
- The focused one-shot target-selection suites pass both existing scenarios
  (2/2).

### Final verification (2026-09-03T16:31:48.0886856+09:00)

- Core typecheck passed; 235 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (989 modules, 3317 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: document-engine client test split (phase 209)

Split `document-engine/engine-client.test.ts` into focused mock/action,
worker-resolution, and basic-adapter test modules. Preserve every test body,
temporary-file setup, client configuration, environment restoration, assertion,
and document-engine behavior; this is a test-organization-only change.

### Success criteria

- `document-engine/engine-client/mock-and-actions.test.ts` contains the mock
  client and document action scenarios and is <= 90 lines.
- `document-engine/engine-client/worker-resolution.test.ts` contains worker
  ping/path/environment resolution scenarios and is <= 65 lines.
- `document-engine/engine-client/basic-adapter.test.ts` contains the basic
  adapter ingest/page scenario and is <= 40 lines.
- The previous mixed `document-engine/engine-client.test.ts` is absent; all
  seven existing scenario blocks remain covered exactly once. Core
  typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing document-engine clients, document actions, worker path resolution,
  environment restoration, basic adapter behavior, temporary-file setup,
  assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T16:19:26.8638711+09:00)

- `document-engine/engine-client.test.ts` is 151 lines and combines seven
  mock/action, worker-resolution, and basic-adapter scenarios; the focused
  client test directory is absent.
- The existing document-engine client suite passes 7/7. Core
  typecheck/tests, evaluation, document-engine 39/39, desktop typecheck/build,
  architecture, and whitespace checks pass.

### Focused verification (2026-09-03T16:21:07.7605011+09:00)

- The mixed original suite is absent. `mock-and-actions.test.ts` is 77 lines,
  `worker-resolution.test.ts` is 55 lines, and `basic-adapter.test.ts` is 32
  lines.
- The focused document-engine client suites pass all seven scenarios (7/7).

### Baseline correction (2026-09-03T16:21:43.8420244+09:00)

- The document-engine client source contains seven `it` scenario blocks, not
  eight: three mock/action, three worker-resolution, and one basic-adapter
  scenario. The recorded baseline and focused result are corrected to 7/7.

### Final verification (2026-09-03T16:23:49.8851357+09:00)

- Core typecheck passed; 234 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (988 modules, 3313 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: Work Discovery repair test split (phase 207)

Split `work-discovery/repair.test.ts` into focused historical replay success
and unavailable-snapshot safety test modules, extracting their shared test
fixture/seed setup into a dedicated fixture module. Preserve every test body,
fixture data, persisted history shape, assertion, and repair replay behavior;
this is a test-organization-only change.

### Success criteria

- `work-discovery/repair/fixtures.ts` contains the shared repair candidate,
  workflow fixture, and history seeding helpers and is <= 140 lines.
- `work-discovery/repair/all-examples.test.ts` contains the successful
  historical replay scenario and is <= 35 lines.
- `work-discovery/repair/unavailable-snapshot.test.ts` contains the missing
  historical snapshot safety scenario and is <= 30 lines.
- The previous mixed `work-discovery/repair.test.ts` is absent; both existing
  scenario blocks remain covered exactly once. Core typecheck/tests/evaluation
  and the full project evaluator remain green.

### Non-goals

- Changing repair candidate replay, historical snapshot availability handling,
  workflow fixtures, seed data, persistence shape, assertions, or production
  imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T16:05:24.4016857+09:00)

- `work-discovery/repair.test.ts` is 158 lines and combines two repair replay
  scenarios with a large shared fixture/history seed; the focused repair test
  directory is absent.
- The existing Work Discovery repair suite passes 2/2. Core typecheck/tests,
  evaluation, document-engine 39/39, desktop typecheck/build, architecture,
  and whitespace checks pass.

### Focused verification (2026-09-03T16:06:54.9452780+09:00)

- The mixed original suite is absent. `fixtures.ts` is 130 lines,
  `all-examples.test.ts` is 20 lines, and
  `unavailable-snapshot.test.ts` is 18 lines.
- The focused Work Discovery repair suites pass both scenarios (2/2).

### Final verification (2026-09-03T16:08:33.3703838+09:00)

- Core typecheck passed; 231 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (984 modules, 3301 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: runtime output-binding test split (phase 206)

Split `runtime/engine/output-binding.test.ts` into focused implicit Slack
binding and approval-node/model-output binding test modules. Preserve every
test body, workflow shape, runtime setup, connector mock, persisted snapshot
assertion, and approval behavior; this is a test-organization-only change.

### Success criteria

- `runtime/engine/output-binding/implicit-slack-binding.test.ts` contains the
  preceding-AI-conclusion binding and approval-gate scenario and is <= 80
  lines.
- `runtime/engine/output-binding/approval-node-binding.test.ts` contains the
  model-emitted-message approval-node binding scenario and is <= 115 lines.
- The previous mixed `runtime/engine/output-binding.test.ts` is absent; both
  existing scenario blocks remain covered exactly once. Core
  typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing runtime output binding, AI conclusion mapping, approval gates,
  model-output mapping, workflow shapes, connector mocks, persisted snapshot
  assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T15:58:54.7608562+09:00)

- `runtime/engine/output-binding.test.ts` is 160 lines and combines two
  output-binding/approval scenarios; the focused output-binding directory is
  absent.
- The existing output-binding suite passes 2/2. Core typecheck/tests,
  evaluation, document-engine 39/39, desktop typecheck/build, architecture,
  and whitespace checks pass.

### Focused verification (2026-09-03T16:01:05.8202689+09:00)

- The mixed original suite is absent. `implicit-slack-binding.test.ts` is 64
  lines and `approval-node-binding.test.ts` is 103 lines.
- The focused output-binding suites pass both scenarios (2/2).

### Final verification (2026-09-03T16:02:45.6657613+09:00)

- Core typecheck passed; 230 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (982 modules, 3294 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: OpenAPI test split (phase 205)

Split `openapi/openapi.test.ts` into focused capability ingestion/invocation,
capability validation, and URL encoding test modules. Preserve every test
body, fixture, mock response, assertion, catalog cleanup, and OpenAPI behavior;
this is a test-organization-only change.

### Success criteria

- `openapi/openapi/ingest-and-invocation.test.ts` contains capability
  registration, read invocation, HEAD invocation, and dotted operationId
  scenarios and is <= 120 lines.
- `openapi/openapi/capability-validation.test.ts` contains write-capability
  blocking and duplicate-operationId scenarios and is <= 70 lines.
- `openapi/openapi/url-encoding.test.ts` contains server-base-path and path
  parameter encoding behavior and is <= 40 lines.
- The previous mixed `openapi/openapi.test.ts` is absent; all seven existing
  scenario blocks remain covered exactly once. Core typecheck/tests/evaluation
  and the full project evaluator remain green.

### Non-goals

- Changing OpenAPI ingestion, capability registration/invocation, write
  blocking, operationId collision handling, URL construction/encoding, test
  fixtures, mock responses, catalog cleanup, assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T15:53:08.1405033+09:00)

- `openapi/openapi.test.ts` is 161 lines and combines seven ingestion,
  invocation, policy, collision, and URL scenarios; the focused OpenAPI test
  directory is absent.
- The existing OpenAPI suite passes 7/7. Core typecheck/tests, evaluation,
  document-engine 39/39, desktop typecheck/build, architecture, and whitespace
  checks pass.

### Focused verification (2026-09-03T15:54:39.5648189+09:00)

- The mixed original suite is absent. `ingest-and-invocation.test.ts` is 104
  lines, `capability-validation.test.ts` is 56 lines, and
  `url-encoding.test.ts` is 32 lines.
- The focused OpenAPI suites pass all seven scenarios (7/7).

### Final verification (2026-09-03T15:56:16.4320616+09:00)

- Core typecheck passed; 229 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (981 modules, 3288 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: scheduler one-time test split (phase 204)

Split `runtime/scheduler.test.ts` into focused one-time execution/retry and
one-time validation/reactivation test modules. Preserve every test body,
fixture, store setup, runtime mock, assertion, and scheduler behavior; this is
a test-organization-only change.

### Success criteria

- `runtime/scheduler/one-time-execution.test.ts` contains failed-execution
  retry and overlapping-tick protection and is <= 105 lines.
- `runtime/scheduler/one-time-validation.test.ts` contains invalid-run-time
  and pending-approval reactivation behavior and is <= 90 lines.
- The previous mixed `runtime/scheduler.test.ts` is absent; all four existing
  scenario blocks remain covered exactly once. Core typecheck/tests/evaluation
  and the full project evaluator remain green.

### Non-goals

- Changing Scheduler one-time execution, retry, overlap protection, invalid
  run-time handling, pending-approval reactivation, fixtures, store setup,
  runtime mocks, assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T15:47:19.7642493+09:00)

- `runtime/scheduler.test.ts` is 162 lines and combines four one-time
  execution/state scenarios; the focused Scheduler test directory is absent.
- The existing Scheduler suite passes 4/4. Core typecheck/tests, evaluation,
  document-engine 39/39, desktop typecheck/build, architecture, and whitespace
  checks pass.

### Focused verification (2026-09-03T15:48:49.1546499+09:00)

- The mixed original suite is absent. `one-time-execution.test.ts` is 93 lines
  and `one-time-validation.test.ts` is 78 lines.
- The focused Scheduler one-time suites pass all four scenarios (4/4).

### Final verification (2026-09-03T15:50:25.1925630+09:00)

- Core typecheck passed; 227 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (979 modules, 3284 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: workflow contract graph test split (phase 203)

Split `workflow/contract-validator/graph.test.ts` into focused step-chain,
branch-contract, classification-control-flow, and cyclic-branch test modules.
Preserve every test body, fixture, workflow shape, assertion, and contract
validation behavior; this is a test-organization-only change.

### Success criteria

- `workflow/contract-validator/graph/chain-contracts.test.ts` contains the
  incompatible step-chain scenario and is <= 40 lines.
- `workflow/contract-validator/graph/branch-contracts.test.ts` contains the
  IF branch contract propagation scenario and is <= 70 lines.
- `workflow/contract-validator/graph/classification-control-flow.test.ts`
  contains classified notification and cyclic-branch scenarios and is <= 95
  lines.
- The previous mixed `workflow/contract-validator/graph.test.ts` is absent;
  all four existing scenario blocks remain covered exactly once. Core
  typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing workflow contract validation, step-chain compatibility, IF branch
  propagation, classification control-flow checks, cyclic-branch detection,
  fixtures, workflow data, assertions, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T15:40:28.9953165+09:00)

- `workflow/contract-validator/graph.test.ts` is 164 lines and combines four
  contract-graph scenarios; the focused graph test directory is absent.
- The existing workflow contract graph suite passes 4/4. Core
  typecheck/tests, evaluation, document-engine 39/39, desktop typecheck/build,
  architecture, and whitespace checks pass.

### Focused verification (2026-09-03T15:42:12.8834723+09:00)

- The mixed original suite is absent. `chain-contracts.test.ts` is 27 lines,
  `branch-contracts.test.ts` is 61 lines, and
  `classification-control-flow.test.ts` is 87 lines.
- The focused workflow contract graph suites pass all four scenarios (4/4).

### Final verification (2026-09-03T15:44:48.1975876+09:00)

- Core typecheck passed; 226 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (978 modules, 3281 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: Slack new-message polling test split (phase 202)

Split `modules/slack/new-message-poll.test.ts` into focused pagination/cursor
behavior and channel-resolution/migration test modules. Preserve every test
body, fixture, mock response, assertion, Slack request shape, and polling
behavior; this is a test-organization-only change.

### Success criteria

- `modules/slack/new-message-poll/pagination.test.ts` contains history-page,
  initial-cursor, and repeated-cursor behavior and is <= 110 lines.
- `modules/slack/new-message-poll/channel-resolution.test.ts` contains
  channel-id resolution and legacy-cursor migration behavior and is <= 80
  lines.
- The previous mixed `modules/slack/new-message-poll.test.ts` is absent; all
  five existing scenario blocks remain covered exactly once. Core
  typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing Slack pagination, cursor initialization, repeated-cursor handling,
  channel resolution, legacy-cursor migration, fixtures, mock responses,
  assertions, test data, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T15:33:23.5137050+09:00)

- `modules/slack/new-message-poll.test.ts` is 165 lines and combines three
  pagination/cursor scenarios with two channel-resolution/migration scenarios;
  the focused polling test directory is absent.
- The existing Slack new-message polling suite passes 5/5. Core
  typecheck/tests, evaluation, document-engine 39/39, desktop typecheck/build,
  architecture, and whitespace checks pass.

### Focused verification (2026-09-03T15:35:07.0216229+09:00)

- The mixed original suite is absent. `pagination.test.ts` is 102 lines and
  `channel-resolution.test.ts` is 68 lines.
- The focused Slack new-message polling suites pass all five scenarios (5/5).

### Final verification (2026-09-03T15:36:44.2910124+09:00)

- Core typecheck passed; 224 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (976 modules, 3275 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

## Current structural task: connection-selection chat test split (phase 201)

Split `agent/commands/chat/connection-selection.test.ts` into focused chooser
presentation and selected-connection follow-up test modules. Preserve every
test body, fixture, assertion, scripted model sequence, session message, and
connection-selection behavior; this is a test-organization-only change.

### Success criteria

- `agent/commands/chat/connection-selection/chooser-card.test.ts` contains
  chooser presentation and list-only behavior and is <= 105 lines.
- `agent/commands/chat/connection-selection/selected-followup.test.ts`
  contains selected-connection next-turn propagation and is <= 80 lines.
- The previous mixed `agent/commands/chat/connection-selection.test.ts` is
  absent; all three existing scenario blocks remain covered exactly once. Core
  typecheck/tests/evaluation and the full project evaluator remain green.

### Focused verification (2026-09-03T15:27:59.7610855+09:00)

- The mixed original suite is absent. `chooser-card.test.ts` is 94 lines and
  `selected-followup.test.ts` is 80 lines.
- The focused connection-selection suites pass all three scenarios (3/3).

### Final verification (2026-09-03T15:29:58.4447825+09:00)

- Core typecheck passed; 223 core test files passed with 717 tests passed and
  3 skipped; the core evaluation passed 11/11.
- Document-engine tests passed 39/39, desktop typecheck/build passed,
  architecture checks passed (975 modules, 3274 dependencies), and
  `git diff --check` passed.
- The split is complete without production-code changes or changes to the
  scenario bodies.

### Non-goals

- Changing command-chat sequencing, connection card presentation, list-only
  behavior, selected connection propagation, fixtures, scripted responses,
  test assertions, test data, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T15:23:38.3005506+09:00)

- `agent/commands/chat/connection-selection.test.ts` is 166 lines and
  combines chooser presentation/list-only behavior with selected-connection
  follow-up behavior; the focused connection-selection directory is absent.
- The existing connection-selection chat suite passes 3/3. Core
  typecheck/tests, evaluation, document-engine 39/39, desktop typecheck/build,
  architecture, and whitespace checks pass.

## Current structural task: Work Discovery correctness test split (phase 200)

Split `testing/e2e/work-discovery-e2e/correctness.test.ts` into focused
candidate replay/schema-safety, clarification, and workbook-artifact
correctness test modules. Preserve every test body, fixture, assertion, E2E
regression, and data shape; this is a test-organization-only change.

### Success criteria

- `testing/e2e/work-discovery-e2e/correctness/synthesis.test.ts` contains
  multi-example replay and truncation candidate coverage and is <= 105 lines.
- `testing/e2e/work-discovery-e2e/correctness/schema-safety.test.ts` contains
  schema-rename candidate coverage and is <= 40 lines.
- `testing/e2e/work-discovery-e2e/correctness/clarification.test.ts` contains
  affected-observation clarification coverage and is <= 50 lines.
- `testing/e2e/work-discovery-e2e/correctness/artifacts.test.ts` contains
  XLSX workbook observation coverage and is <= 45 lines.
- The previous mixed `testing/e2e/work-discovery-e2e/correctness.test.ts` is
  absent; all five existing scenario blocks remain covered exactly once. Core
  typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing candidate enumeration/replay, truncation or schema-rename safety,
  clarification scope, workbook observation, fixtures, test assertions, test
  data, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T15:13:49.9005911+09:00)

- `testing/e2e/work-discovery-e2e/correctness.test.ts` is 167 lines and
  combines synthesis, clarification, and workbook-artifact correctness; the
  focused correctness directory is absent.
- The existing Work Discovery correctness suite passes 5/5. Core
  typecheck/tests, evaluation, document-engine 39/39, desktop typecheck/build,
  architecture, and whitespace checks pass.

### Final (2026-09-03T15:20:42.1148397+09:00)

- The former mixed 167-line suite is now four focused modules: replay
  `88` lines, schema safety `31` lines, clarification `41` lines, and
  artifacts `19` lines; the mixed original suite is absent.
- All five Work Discovery correctness scenarios remain covered exactly once;
  focused suites pass `5/5`.
- Core typecheck/tests/evaluation, document-engine 39/39, desktop
  typecheck/build, architecture check, and `git diff --check` all pass.

## Current structural task: approval corrupt-state test split (phase 199)

Split `runtime/engine/approval/corrupt-state.test.ts` into focused persisted
snapshot/log recovery and approval-action validation test modules. Preserve
every test body, fixture, assertion, fail-closed error, cleanup behavior, and
runtime behavior; this is a test-organization-only change.

### Success criteria

- `runtime/engine/approval/corrupt-state/snapshot-state.test.ts` contains
  deleted/absent/corrupt snapshot and persisted-log recovery coverage and is
  <= 145 lines.
- `runtime/engine/approval/corrupt-state/approval-actions.test.ts` contains
  invalid approval-action reference coverage and is <= 60 lines.
- The previous mixed `runtime/engine/approval/corrupt-state.test.ts` is
  absent; all six existing scenario blocks and seven concrete cases (including
  both parameterized cases) remain covered exactly once. Core
  typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing approval continuation, snapshot/log parsing, fail-closed error
  codes, action validation, connector side effects, fixtures, test
  assertions, test data, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T15:05:13.6918459+09:00)

- `runtime/engine/approval/corrupt-state.test.ts` is 171 lines and combines
  persisted snapshot/log recovery with invalid approval-action validation; the
  focused corrupt-state directory is absent.
- The existing corrupt-state suite passes 7/7 (six blocks, including the two
  parameterized cases). Core typecheck/tests, evaluation, document-engine
  39/39, desktop typecheck/build, architecture, and whitespace checks pass.

### Final (2026-09-03T15:11:01.9938817+09:00)

- The former mixed 171-line suite is now two focused modules: snapshot/state
  `131` lines and approval actions `44` lines; the mixed original suite is
  absent.
- All six scenario blocks and seven concrete cases remain covered exactly
  once; focused suites pass `7/7`.
- Core typecheck/tests/evaluation, document-engine 39/39, desktop
  typecheck/build, architecture check, and `git diff --check` all pass.

## Current structural task: CLI model test split (phase 198)

Split `agent/model/cli.test.ts` into focused provider/model catalog, CLI JSON
schema/parsing, and Codex CLI adapter test modules. Preserve every test body,
fixture, assertion, parsing diagnostic, and model/adapter behavior; this is a
test-organization-only change.

### Success criteria

- `agent/model/cli/config-catalog.test.ts` contains provider normalization and
  model-catalog coverage and is <= 55 lines.
- `agent/model/cli/json.test.ts` contains structured JSON parsing and Zod
  schema conversion coverage and is <= 110 lines.
- `agent/model/cli/adapter.test.ts` contains Codex CLI argument and failure
  message coverage and is <= 55 lines.
- The previous mixed `agent/model/cli.test.ts` is absent; all seventeen
  existing scenario blocks remain covered exactly once. Core
  typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing provider normalization, model catalog parsing, JSON recovery,
  schema conversion, Codex CLI arguments, error projection, fixtures, test
  assertions, test data, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T14:56:51.7303581+09:00)

- `agent/model/cli.test.ts` is 176 lines and combines provider/model catalog,
  CLI JSON, and Codex adapter coverage; the focused CLI test directory is
  absent.
- The existing CLI model suite passes 17/17. Core typecheck/tests,
  evaluation, document-engine 39/39, desktop typecheck/build, architecture,
  and whitespace checks pass.

### Final (2026-09-03T15:00:00.4071250+09:00)

- The former mixed 176-line suite is now three focused modules: config/catalog
  `35` lines, JSON `101` lines, and adapter `42` lines; the mixed original
  suite is absent.
- All seventeen CLI model scenarios remain covered exactly once; focused
  suites pass `17/17`.
- Core typecheck/tests/evaluation, document-engine 39/39, desktop
  typecheck/build, architecture check, and `git diff --check` all pass.

## Current structural task: webhook acceptance test split (phase 197)

Split `triggers/webhook/listener/acceptance.test.ts` into focused request
security and delivery identity/path test modules. Preserve every test body,
listener lifecycle, port, fixture, assertion, header-redaction behavior, and
webhook behavior; this is a test-organization-only change.

### Success criteria

- `triggers/webhook/listener/acceptance/security.test.ts` contains signed
  request, HMAC/header redaction, and host-header safety coverage and is <=
  115 lines.
- `triggers/webhook/listener/acceptance/delivery.test.ts` contains provider
  idempotency, keyless request identity, and URL-decoding coverage and is <=
  95 lines.
- The previous mixed `triggers/webhook/listener/acceptance.test.ts` is absent;
  all six existing scenario blocks remain covered exactly once. Core
  typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing webhook authentication, header redaction, host handling, request
  identity, path decoding, listener lifecycle, ports, fixtures, test
  assertions, test data, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T14:49:50.1196195+09:00)

- `triggers/webhook/listener/acceptance.test.ts` is 176 lines and combines
  request security with delivery identity/path acceptance; the focused
  acceptance directory is absent.
- The existing webhook acceptance suite passes 6/6. Core typecheck/tests,
  evaluation, document-engine 39/39, desktop typecheck/build, architecture,
  and whitespace checks pass.

### Final (2026-09-03T14:53:01.9972708+09:00)

- The former mixed 176-line suite is now two focused modules: security
  `105` lines and delivery `83` lines; the mixed original suite is absent.
- All six webhook acceptance scenarios remain covered exactly once; focused
  suites pass `6/6`.
- Core typecheck/tests/evaluation, document-engine 39/39, desktop
  typecheck/build, architecture check, and `git diff --check` all pass.

## Current structural task: one-shot command test split (phase 196)

Split `agent/commands/service/one-shot.test.ts` into focused basic queueing
and external-target selection test modules. Preserve every test body, fixture,
assertion, session propagation, and command behavior; this is a
test-organization-only change.

### Success criteria

- `agent/commands/service/one-shot/queueing.test.ts` contains basic one-shot
  queue registration coverage and is <= 65 lines.
- `agent/commands/service/one-shot/target-selection.test.ts` contains target
  card and selected-target queue coverage and is <= 160 lines.
- The previous mixed `agent/commands/service/one-shot.test.ts` is absent; all
  three existing scenario blocks remain covered exactly once. Core
  typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing one-shot queueing, target selection, connection binding, session
  propagation, fixtures, test assertions, test data, or production imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T14:43:41.1783076+09:00)

- `agent/commands/service/one-shot.test.ts` is 179 lines and combines basic
  queue registration with external-target presentation and selected-target
  queueing; the focused one-shot directory is absent.
- The existing one-shot service suite passes 3/3. Core typecheck/tests,
  evaluation, document-engine 39/39, desktop typecheck/build, architecture,
  and whitespace checks pass.

### Final (2026-09-03T14:47:00.9577100+09:00)

- The former mixed 179-line suite is now two focused modules: basic queueing
  `32` lines and target selection `151` lines; the mixed original suite is
  absent.
- All three one-shot scenarios remain covered exactly once; focused suites
  pass `3/3`.
- Core typecheck/tests/evaluation, document-engine 39/39, desktop
  typecheck/build, architecture check, and `git diff --check` all pass.

## Current structural task: scheduled scheduler test split (phase 195)

Split `runtime/scheduler/scheduled.test.ts` into focused retry/state and
failure/recovery test modules. Preserve every test body, fixture, assertion,
timer cleanup, and scheduler behavior; this is a test-organization-only
change.

### Success criteria

- `runtime/scheduler/scheduled/retry-state.test.ts` contains scheduled retry
  and persisted last-fired recovery coverage and is <= 120 lines.
- `runtime/scheduler/scheduled/failure-recovery.test.ts` contains scheduled
  execution-exception isolation and scheduler-tick recovery coverage and is <=
  105 lines.
- The previous mixed `runtime/scheduler/scheduled.test.ts` is absent; all four
  existing scenario blocks remain covered exactly once. Core
  typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing scheduler timing, retry semantics, persisted state handling,
  exception isolation, fixtures, test assertions, test data, or production
  imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Baseline (2026-09-03T14:35:03.7043971+09:00)

- `runtime/scheduler/scheduled.test.ts` is 182 lines and combines retry,
  persisted-state corruption, execution-exception isolation, and scheduler
  tick-recovery coverage; the focused scheduled directory is absent.
- The existing scheduled scheduler suite passes 4/4. Core typecheck/tests,
  evaluation, document-engine 39/39, desktop typecheck/build, architecture,
  and whitespace checks pass.

### Final (2026-09-03T14:40:06.7094861+09:00)

- The former mixed 182-line suite is now two focused modules: retry/state
  `95` lines and failure/recovery `96` lines; the mixed original suite is
  absent.
- All four scheduled scheduler scenarios remain covered exactly once; focused
  suites pass `4/4`.
- Core typecheck/tests/evaluation, document-engine 39/39, desktop
  typecheck/build, architecture check, and `git diff --check` all pass.

## Current structural task: execution observability test split (phase 194)

Split `runtime/engine/execution-observability.test.ts` into approval/queue
observability coverage and progress/observer isolation coverage. Preserve every
test body, fixture, assertion, and runtime behavior; this is a
test-organization-only change.

### Success criteria

- `runtime/engine/execution-observability/approval-queue.test.ts` contains
  approval-gated HTTP and serialized ephemeral queue coverage and is <= 105
  lines.
- `runtime/engine/execution-observability/progress-observers.test.ts` contains
  persisted step progress and observer-failure isolation coverage and is <=
  115 lines.
- The previous mixed `execution-observability.test.ts` is absent; all four
  existing scenario blocks remain covered exactly once. Core
  typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing approval gating, network I/O prevention, ephemeral queue ordering,
  progress events, observer failure isolation, fixtures, test assertions, test
  data, or public imports.
- Refactoring production runtime code or unrelated tests in this slice.

### Baseline

- `runtime/engine/execution-observability.test.ts` is 182 lines and combines
  approval/queue behavior with progress and observer isolation; the focused
  observability modules are absent. The existing suite passes 4/4, and Core
  typecheck/tests/evaluation, document-engine, desktop typecheck/build,
  architecture, and whitespace checks pass (full evaluator: 212 test files,
  717 passed, 3 skipped).

## Current structural task: HTTP connector methods test split (phase 193)

Split `modules/http/connector/methods.test.ts` into read request/response
coverage and explicit write-method policy coverage. Preserve every test body,
fixture, assertion, and connector behavior; this is a test-organization-only
change.

### Success criteria

- `modules/http/connector/methods/read-responses.test.ts` contains GET success,
  HTTP failure, bounded error details, and truncated error-body coverage and is
  <= 120 lines.
- `modules/http/connector/methods/write-methods.test.ts` contains explicit
  POST body handling and read-only/write-method rejection coverage and is <= 90
  lines.
- The previous mixed `methods.test.ts` is absent; all seven existing scenario
  blocks remain covered exactly once. Core typecheck/tests/evaluation and the
  full project evaluator remain green.

### Non-goals

- Changing HTTP request/response behavior, error previews, POST method/body
  policy, read-only method policy, fixtures, test assertions, test data, or
  public imports.
- Refactoring production HTTP connector code or unrelated tests in this slice.

### Baseline

- `modules/http/connector/methods.test.ts` is 184 lines and combines read
  request/response behavior with explicit POST and read-only method policy;
  the focused method modules are absent. The existing suite passes 7/7, and
  Core typecheck/tests/evaluation, document-engine, desktop typecheck/build,
  architecture, and whitespace checks pass (full evaluator: 211 test files,
  717 passed, 3 skipped).

## Current structural task: AI privacy policy test split (phase 192)

Split `runtime/ai-investigation/decision/privacy-policy.test.ts` into denied
content/masking coverage and allowed document-evidence coverage. Preserve every
test body, fixture, assertion, and privacy behavior; this is a
test-organization-only change.

### Success criteria

- `runtime/ai-investigation/decision/privacy-policy/denials.test.ts` contains
  cloud-content masking, fail-closed document policy, and separate email-body
  policy coverage and is <= 125 lines.
- `runtime/ai-investigation/decision/privacy-policy/allowances.test.ts`
  contains default and explicit document-evidence allowance coverage and is <=
  90 lines.
- The previous mixed `privacy-policy.test.ts` is absent; all five existing
  scenario blocks remain covered exactly once. Core typecheck/tests/evaluation
  and the full project evaluator remain green.

### Non-goals

- Changing cloud privacy policy enforcement, content masking, fail-closed
  behavior, document consent, email-body policy isolation, fixtures, test
  assertions, test data, or public imports.
- Refactoring production AI investigation code or unrelated tests in this
  slice.

### Baseline

- `runtime/ai-investigation/decision/privacy-policy.test.ts` is 184 lines and
  combines denied/masked content with allowed document evidence; the focused
  privacy-policy modules are absent. The existing suite passes 5/5, and Core
  typecheck/tests/evaluation, document-engine, desktop typecheck/build,
  architecture, and whitespace checks pass (full evaluator: 210 test files,
  717 passed, 3 skipped).

## Current structural task: workflow repository test split (phase 191)

Split `store/workflow-repository.test.ts` into settings/cleanup persistence
coverage and workflow save/version/validation coverage. Preserve every test
body, fixture, assertion, and repository behavior; this is a
test-organization-only change.

### Success criteria

- `store/workflow-repository/settings-cleanup.test.ts` contains global
  execution settings, missing-workflow activation, malformed connection, and
  workflow deletion cleanup coverage and is <= 100 lines.
- `store/workflow-repository/workflow-save.test.ts` contains workflow version,
  disabled default, reopen persistence, and missing-parameter rejection
  coverage and is <= 125 lines.
- The previous mixed `workflow-repository.test.ts` is absent; all eight
  existing scenario blocks remain covered exactly once. Core
  typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing settings persistence, connection degradation, deletion cleanup,
  workflow versioning, activation defaults, reopen persistence, contract
  validation, fixtures, test assertions, test data, or public imports.
- Refactoring production repository code or unrelated tests in this slice.

### Baseline

- `store/workflow-repository.test.ts` is 184 lines and combines settings/
  deletion cleanup persistence with workflow save/version/reopen/validation;
  the focused workflow repository modules are absent. The existing suite
  passes 8/8, and Core typecheck/tests/evaluation, document-engine, desktop
  typecheck/build, architecture, and whitespace checks pass (full evaluator:
  209 test files, 717 passed, 3 skipped).

## Current structural task: execution lifecycle test split (phase 190)

Split `runtime/engine/execution-lifecycle.test.ts` into runtime context
injection/connector lifecycle coverage and execution validation/cancellation/
ephemeral record coverage. Preserve every test body, fixture, assertion, and
runtime behavior; this is a test-organization-only change.

### Success criteria

- `runtime/engine/execution-lifecycle/contexts.test.ts` contains artifact sink
  injection and live connector replacement/removal coverage and is <= 115
  lines.
- `runtime/engine/execution-lifecycle/execution-records.test.ts` contains
  malformed input, preflight cancellation, and ephemeral execution record
  coverage and is <= 105 lines.
- The previous mixed `execution-lifecycle.test.ts` is absent; all five
  existing scenario blocks remain covered exactly once. Core
  typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing artifact sink injection, connector replacement/removal, workflow
  validation, cancellation recording, ephemeral execution persistence,
  fixtures, test assertions, test data, or public imports.
- Refactoring production runtime code or unrelated tests in this slice.

### Baseline

- `runtime/engine/execution-lifecycle.test.ts` is 194 lines and combines
  runtime context/connector lifecycle with workflow validation, cancellation,
  and ephemeral execution records; the focused lifecycle modules are absent.
  The existing suite passes 5/5, and Core typecheck/tests/evaluation,
  document-engine, desktop typecheck/build, architecture, and whitespace
  checks pass (full evaluator: 208 test files, 717 passed, 3 skipped).

## Current structural task: discovery repository test split (phase 189)

Split `store/discovery-repository.test.ts` into discovery session persistence/
schema coverage and example/replay JSON validation coverage. Preserve every
test body, fixture, assertion, and repository behavior; this is a
test-organization-only change.

### Success criteria

- `store/discovery-repository/session.test.ts` contains session persistence,
  malformed-session, and schema validation coverage and is <= 105 lines.
- `store/discovery-repository/examples-replay.test.ts` contains malformed and
  invalid artifact-id plus replay upsert coverage and is <= 115 lines.
- The previous mixed `discovery-repository.test.ts` is absent; all six existing
  scenario blocks remain covered exactly once. Core typecheck/tests/evaluation
  and the full project evaluator remain green.

### Non-goals

- Changing discovery repository persistence, JSON parsing/validation, replay
  upserts, fixtures, test assertions, test data, or public imports.
- Refactoring production repository code or unrelated tests in this slice.

### Baseline

- `store/discovery-repository.test.ts` is 195 lines and combines session
  persistence/schema validation with example artifact-id and replay validation;
  the focused discovery repository modules are absent. The existing suite
  passes 6/6, and Core typecheck/tests/evaluation, document-engine, desktop
  typecheck/build, architecture, and whitespace checks pass (full evaluator:
  207 test files, 717 passed, 3 skipped).

## Current structural task: HTTP response-limits test split (phase 188)

Split `modules/http/request/response-limits.test.ts` into response body limit
semantics and transport response-body cancellation coverage. Preserve every
test body, fixture, assertion, and request behavior; this is a
test-organization-only change.

### Success criteria

- `modules/http/request/response-limits/limits.test.ts` contains response
  streaming, content-length/default limit, cancellation-failure, and UTF-8
  truncation coverage and is <= 130 lines.
- `modules/http/request/response-limits/transport.test.ts` contains redirect
  and HEAD response-body cancellation coverage and is <= 90 lines.
- The previous mixed `response-limits.test.ts` is absent; all nine existing
  scenario blocks remain covered exactly once. Core typecheck/tests/evaluation
  and the full project evaluator remain green.

### Non-goals

- Changing response byte limits, UTF-8 handling, reader cancellation,
  redirect rejection, HEAD handling, fixtures, test assertions, test data, or
  public imports.
- Refactoring production HTTP code or unrelated tests in this slice.

### Baseline

- `modules/http/request/response-limits.test.ts` is 197 lines and combines
  response body limit/truncation semantics with redirect and HEAD transport
  cleanup; the focused response-limits modules are absent. The existing suite
  passes 9/9, and Core typecheck/tests/evaluation, document-engine, desktop
  typecheck/build, architecture, and whitespace checks pass (full evaluator:
  206 test files, 717 passed, 3 skipped).

### Final (2026-09-03T13:53:42.7724780+09:00)

- The mixed response-limits suite was split into
  `response-limits/limits.test.ts` (124 lines) and
  `response-limits/transport.test.ts` (80 lines); the previous mixed file is
  absent.
- All four body-limit scenarios, the four parameterized default-limit cases,
  and the four transport cleanup scenarios remain present exactly once.
  Focused tests pass 12/12. The full project evaluator passes: 207 test files,
  717 passed, 3 skipped; document-engine 39/39; desktop typecheck/build,
  architecture, and whitespace checks pass.
- Production HTTP behavior, test assertions, data, and public imports were
  not changed.

## Current structural task: control-flow test split (phase 187)

Split `runtime/engine/control-flow.test.ts` into basic branch selection
coverage and nested/risk branch traversal coverage. Preserve every test body,
fixture, assertion, and runtime behavior; this is a test-organization-only
change.

### Success criteria

- `runtime/engine/control-flow/selection.test.ts` contains linear scan,
  weekly branch, and trigger-input condition coverage and is <= 100 lines.
- `runtime/engine/control-flow/traversal.test.ts` contains outer-step,
  nested-risk branch, and declared-result binding coverage and is <= 145 lines.
- The previous mixed `control-flow.test.ts` is absent; all five existing
  scenario blocks remain covered exactly once. Core typecheck/tests/evaluation
  and the full project evaluator remain green.

### Non-goals

- Changing control-flow traversal, branch selection, trigger-input handling,
  risk classification, output binding, fixtures, test assertions, test data,
  or public imports.
- Refactoring production runtime code or unrelated tests in this slice.

### Baseline

- `runtime/engine/control-flow.test.ts` is 198 lines and combines basic
  branch selection with nested/risk traversal and output binding; the focused
  control-flow modules are absent. The existing control-flow suite passes 5/5,
  and Core typecheck/tests/evaluation, document-engine, desktop
  typecheck/build, architecture, and whitespace checks pass (full evaluator:
  205 test files, 717 passed, 3 skipped).

### Final (2026-09-03T13:48:38.3657425+09:00)

- The mixed control-flow suite was split into `control-flow/selection.test.ts`
  (73 lines) and `control-flow/traversal.test.ts` (130 lines); the previous
  mixed file is absent.
- All three basic-selection scenarios and both nested/risk traversal scenarios
  remain present exactly once. Focused tests pass 5/5. The full project
  evaluator passes: 206 test files, 717 passed, 3 skipped; document-engine
  39/39; desktop typecheck/build, architecture, and whitespace checks pass.
- Production runtime behavior, test assertions, data, and public imports
  were not changed.

## Current structural task: approval continuation test split (phase 186)

Split `runtime/engine/approval/continuation.test.ts` into approval
continuation success-flow coverage and approval/execution guard coverage.
Preserve every test body, fixture, assertion, and runtime behavior; this is a
test-organization-only change.

### Success criteria

- `runtime/engine/approval/continuation/basic.test.ts` contains the normal and
  branch continuation success flows and is <= 145 lines.
- `runtime/engine/approval/continuation/guards.test.ts` contains the global
  execution guard and branch approval-bypass guard and is <= 110 lines.
- The previous mixed `continuation.test.ts` is absent; all four existing
  scenario blocks remain covered exactly once. Core typecheck/tests/evaluation
  and the full project evaluator remain green.

### Non-goals

- Changing approval continuation, concurrency handling, global execution
  guards, branch traversal, fixtures, test assertions, test data, or public
  imports.
- Refactoring production runtime code or unrelated tests in this slice.

### Baseline

- `runtime/engine/approval/continuation.test.ts` is 231 lines and combines
  two approval continuation success flows with global execution and branch
  approval guards; the focused continuation modules are absent. The existing
  approval continuation suite passes 4/4, and Core typecheck/tests/evaluation,
  document-engine, desktop typecheck/build, architecture, and whitespace
  checks pass (full evaluator: 204 test files, 717 passed, 3 skipped).

### Final (2026-09-03T13:43:02.3422787+09:00)

- The mixed approval continuation suite was split into
  `continuation/basic.test.ts` (136 lines) and
  `continuation/guards.test.ts` (100 lines); the previous mixed file is
  absent.
- Both success-flow scenarios and both execution/approval guard scenarios
  remain present exactly once. Focused tests pass 4/4. The full project
  evaluator passes: 205 test files, 717 passed, 3 skipped; document-engine
  39/39; desktop typecheck/build, architecture, and whitespace checks pass.
- Production runtime behavior, test assertions, data, and public imports
  were not changed.

## Current structural task: checkpoint recovery test split (phase 185)

Split `work-discovery/service/recovery/checkpoint.test.ts` into persisted
checkpoint resume coverage and failed automatic recovery retry coverage.
Preserve every test body, fixture, assertion, and recovery behavior; this is
a test-organization-only change.

### Success criteria

- `work-discovery/service/recovery/checkpoint/persisted.test.ts` contains
  persisted snapshot resume coverage and is <= 125 lines.
- `work-discovery/service/recovery/checkpoint/retry.test.ts` contains failed
  automatic recovery and saved-checkpoint retry coverage and is <= 120 lines.
- The previous mixed `checkpoint.test.ts` is absent; both existing scenario
  blocks and both parameterized checkpoint statuses remain covered exactly
  once. Core typecheck/tests/evaluation and the full project evaluator remain
  green.

### Non-goals

- Changing persisted snapshot recovery, live-source read protection, automatic
  recovery failure handling, manual retry behavior, fixtures, test assertions,
  test data, or public imports.
- Refactoring production work-discovery recovery code or unrelated tests in
  this slice.

### Baseline

- `work-discovery/service/recovery/checkpoint.test.ts` is 211 lines and
  combines parameterized persisted snapshot resume with failed automatic
  recovery and saved-checkpoint retry; the focused checkpoint modules are
  absent. The existing checkpoint suite passes 3/3, and Core typecheck/tests/
  evaluation, document-engine, desktop typecheck/build, architecture, and
  whitespace checks pass (full evaluator: 203 test files, 717 passed, 3
  skipped).

### Final (2026-09-03T13:37:05.2013833+09:00)

- The mixed checkpoint suite was split into `checkpoint/persisted.test.ts`
  (109 lines) and `checkpoint/retry.test.ts` (112 lines); the previous mixed
  file is absent.
- Both parameterized persisted-resume statuses and the automatic recovery
  failure/manual retry scenario remain present exactly once. Focused tests
  pass 3/3. The full project evaluator passes: 204 test files, 717 passed,
  3 skipped; document-engine 39/39; desktop typecheck/build, architecture,
  and whitespace checks pass.
- Production recovery behavior, test assertions, data, and public imports
  were not changed.

## Current structural task: repair command test split (phase 184)

Split the mixed `agent/commands/service/repair.test.ts` scenarios into repair
apply/replay behavior and repair rejection boundary behavior, with their
shared fixture isolated. Preserve every test body, fixture, assertion, and
command behavior; this is a test-organization-only change.

### Success criteria

- `agent/commands/service/repair/apply.test.ts` contains repair inspect/apply
  replay coverage and is <= 150 lines.
- `agent/commands/service/repair/reject.test.ts` contains repair rejection
  mutation-boundary coverage and is <= 70 lines.
- `agent/commands/service/repair/fixtures.ts` contains the shared repair
  candidate/workflow fixture and is <= 90 lines.
- The previous mixed `service/repair.test.ts` is absent; both existing
  scenarios remain covered exactly once. Core typecheck/tests/evaluation and
  the full project evaluator remain green.

### Non-goals

- Changing repair inspection, replay, application, rejection boundaries,
  workflow versions, fixtures, test assertions, test data, or public imports.
- Refactoring production command service or repair code or unrelated tests in
  this slice.

### Baseline

- `agent/commands/service/repair.test.ts` is 211 lines and combines a large
  inspect/apply replay scenario with a separate rejection boundary scenario
  and shared fixture data; the focused repair modules are absent. The
  existing repair suite passes 2/2, and Core typecheck/tests/evaluation,
  document-engine, desktop typecheck/build, architecture, and whitespace
  checks pass.

### Final (2026-09-03T13:30:00.4433319+09:00)

- The mixed repair suite was split into `repair/apply.test.ts` (117 lines),
  `repair/reject.test.ts` (34 lines), and shared `repair/fixtures.ts` (70
  lines); the previous mixed file is absent.
- Both repair scenarios remain present exactly once, and the focused suites
  pass 2/2. The full project evaluator passes: 203 test files, 717 passed, 3
  skipped; document-engine 39/39; desktop typecheck/build, architecture, and
  whitespace checks pass.
- Production repair behavior, test assertions, data, and public imports were
  not changed.

## Current structural task: command-chat test split (phase 183)

Split the mixed `agent/commands/chat.test.ts` scenarios into provider
compatibility/cancellation, command-loop behavior, and validated UI
presentation/input handling. Preserve every test body, fixture, assertion, and
chat behavior; this is a test-organization-only change.

### Success criteria

- `agent/commands/chat/provider-compatibility.test.ts` contains unsupported
  provider command and pre-aborted request coverage and is <= 80 lines.
- `agent/commands/chat/command-loop.test.ts` contains command execution and
  internal command-result loop coverage and is <= 100 lines.
- `agent/commands/chat/presentation.test.ts` contains typed input request and
  validated `ui.present` card coverage and is <= 100 lines.
- The previous mixed `chat.test.ts` is absent; all six existing scenario
  blocks and all three parameterized providers remain covered exactly once.
  Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing provider compatibility handling, cancellation, command execution
  loops, result transcript isolation, typed input requests, UI presentation,
  fixtures, test assertions, test data, or public imports.
- Refactoring production command-chat code or unrelated tests in this slice.

### Baseline

- `agent/commands/chat.test.ts` is 202 lines and combines provider
  compatibility/cancellation, command-loop transcript behavior, and
  validated presentation/input handling; the focused modules are absent. The
  existing command-chat suite passes 8/8, and Core typecheck/tests/evaluation,
  document-engine, desktop typecheck/build, architecture, and whitespace
  checks pass.

### Final (2026-09-03T13:21:09.4254796+09:00)

- The mixed command-chat suite was split into
  `chat/provider-compatibility.test.ts` (60 lines),
  `chat/command-loop.test.ts` (82 lines), and `chat/presentation.test.ts` (80
  lines); the previous mixed file is absent.
- All six command-chat scenario blocks and all three parameterized providers
  remain present exactly once, and the focused suites pass 8/8. The full
  project evaluator passes: 202 test files, 717 passed, 3 skipped;
  document-engine 39/39; desktop typecheck/build, architecture, and
  whitespace checks pass.
- Production command-chat behavior, test assertions, data, and public imports
  were not changed.

## Current structural task: runtime contract-guard test split (phase 182)

Split the mixed `runtime/engine/contract-guards.test.ts` scenarios into
missing-connector fail-closed behavior, output-contract external-delivery
gates, and input-schema-drift repair proposals. Preserve every test body,
fixture, assertion, and runtime behavior; this is a test-organization-only
change.

### Success criteria

- `runtime/engine/contracts/connector.test.ts` contains missing-connector
  fail-closed coverage and is <= 70 lines.
- `runtime/engine/contracts/output-contract.test.ts` contains output-contract
  delivery-gate coverage and is <= 105 lines.
- `runtime/engine/contracts/repair-proposal.test.ts` contains bounded repair
  proposal persistence coverage and is <= 90 lines.
- The previous mixed `contract-guards.test.ts` is absent; all three existing
  scenarios remain covered exactly once. Core typecheck/tests/evaluation and
  the full project evaluator remain green.

### Non-goals

- Changing connector-missing behavior, output-contract gating, input schema
  drift detection, repair proposal persistence, fixtures, test assertions,
  test data, or public imports.
- Refactoring production runtime engine code or unrelated tests in this
  slice.

### Baseline

- `runtime/engine/contract-guards.test.ts` is 203 lines and combines
  connector fail-closed, output-contract delivery gating, and input-schema
  drift repair-proposal scenarios; the focused contract modules are absent.
  The existing guard suite passes 3/3, and Core typecheck/tests/evaluation,
  document-engine, desktop typecheck/build, architecture, and whitespace
  checks pass.

### Final (2026-09-03T13:15:37.9524092+09:00)

- The mixed contract-guard suite was split into
  `engine/contracts/connector.test.ts` (41 lines),
  `engine/contracts/output-contract.test.ts` (98 lines), and
  `engine/contracts/repair-proposal.test.ts` (80 lines); the previous mixed
  file is absent.
- All three contract-guard scenarios remain present exactly once, and the
  focused suites pass 3/3. The full project evaluator passes: 200 test files,
  717 passed, 3 skipped; document-engine 39/39; desktop typecheck/build,
  architecture, and whitespace checks pass.
- Production runtime behavior, test assertions, data, and public imports were
  not changed.

## Current structural task: design-tools test split (phase 181)

Split the mixed `design-tools/design-tools.test.ts` scenarios into connector
and source inventory, source read/policy boundaries, capability discovery, and
tool-call/result limits. Preserve every test body, assertion, and design-tool
behavior; this is a test-organization-only change.

### Success criteria

- `design-tools/inventory.test.ts` contains connection, local-file, and tool
  catalog listing coverage and is <= 80 lines.
- `design-tools/source-access.test.ts` contains bounded source reads,
  path-safety, local-data policy, and disconnected-folder coverage and is <=
  130 lines.
- `design-tools/capabilities.test.ts` contains connected capability and
  packaged-action discovery coverage and is <= 70 lines.
- `design-tools/limits.test.ts` contains tool-call and formatted-result bounds
  coverage and is <= 45 lines.
- The previous mixed `design-tools.test.ts` is absent; all eight existing
  scenarios remain covered exactly once. Core typecheck/tests/evaluation and
  the full project evaluator remain green.

### Non-goals

- Changing connector/source inventory, bounded reads, path safety, local-data
  policy, disconnected-folder handling, capability discovery, packaged-action
  visibility, tool-call limits, result truncation, fixtures, test assertions,
  test data, or public imports.
- Refactoring production design-tools code or unrelated tests in this slice.

### Baseline

- `design-tools/design-tools.test.ts` is 213 lines and combines inventory,
  source access/policy, capability discovery, and tool-call/result-limit
  scenarios; the focused modules are absent. The existing design-tools suite
  passes 8/8, and Core typecheck/tests/evaluation, document-engine, desktop
  typecheck/build, architecture, and whitespace checks pass.

### Final (2026-09-03T13:09:53.2206345+09:00)

- The mixed design-tools suite was split into `inventory.test.ts` (59 lines),
  `source-access.test.ts` (119 lines), `capabilities.test.ts` (33 lines), and
  `limits.test.ts` (20 lines); the previous mixed file is absent.
- All eight design-tools scenarios remain present exactly once, and the
  focused suites pass 8/8. The full project evaluator passes: 198 test files,
  717 passed, 3 skipped; document-engine 39/39; desktop typecheck/build,
  architecture, and whitespace checks pass.
- Production design-tools behavior, test assertions, data, and public imports
  were not changed.

## Current structural task: AI output binding test split (phase 180)

Split the mixed `workflow/bindings/ai-output.test.ts` scenarios into default
AI conclusion behavior, explicit declared-output bindings, and undeclared
output fallback protection. Preserve every test body, assertion, and binding
behavior; this is a test-organization-only change.

### Success criteria

- `workflow/bindings/default-conclusion.test.ts` contains implicit/default AI
  conclusion binding coverage and is <= 120 lines.
- `workflow/bindings/explicit-output.test.ts` contains explicit declared
  output-field binding coverage and is <= 120 lines.
- `workflow/bindings/undeclared-output.test.ts` contains undeclared output
  fallback protection coverage and is <= 70 lines.
- The previous mixed `ai-output.test.ts` is absent; all five existing
  scenarios remain covered exactly once. Core typecheck/tests/evaluation and
  the full project evaluator remain green.

### Non-goals

- Changing default AI conclusion selection, explicit output binding,
  undeclared-output protection, fixtures, test assertions, test data, or
  public imports.
- Refactoring production workflow binding code or unrelated tests in this
  slice.

### Baseline

- `workflow/bindings/ai-output.test.ts` is 248 lines and combines default AI
  conclusion selection, explicit declared output bindings, and undeclared
  fallback protection; the focused modules are absent. The existing AI output
  suite passes 5/5, and Core typecheck/tests/evaluation, document-engine,
  desktop typecheck/build, architecture, and whitespace checks pass.

### Final (2026-09-03T13:04:11.6704815+09:00)

- The mixed AI output suite was split into
  `bindings/default-conclusion.test.ts` (107 lines),
  `bindings/explicit-output.test.ts` (100 lines), and
  `bindings/undeclared-output.test.ts` (53 lines); the previous mixed file is
  absent.
- All five AI output scenarios remain present exactly once, and the focused
  suites pass 5/5. The full project evaluator passes: 195 test files, 717
  passed, 3 skipped; document-engine 39/39; desktop typecheck/build,
  architecture, and whitespace checks pass.
- Production binding behavior, test assertions, data, and public imports were
  not changed.

## Current structural task: workflow binding test split (phase 179)

Split the mixed `workflow/bindings.test.ts` scenarios into file-to-Slack
binding behavior, structured HTTP/transform table bindings, and Gmail trigger
bindings. Preserve every test body, shared fixture, assertion, and binding
behavior; this is a test-organization-only change.

### Success criteria

- `workflow/bindings/file-to-slack.test.ts` contains folder-event-to-document,
  legacy path replacement, and runtime parameter binding coverage and is <=
  140 lines.
- `workflow/bindings/structured-transform.test.ts` contains structured HTTP
  response and multi-source transform-table coverage and is <= 130 lines.
- `workflow/bindings/gmail.test.ts` contains Gmail trigger message binding
  coverage and is <= 80 lines.
- `workflow/bindings/fixtures.ts` contains the shared folder-to-Slack
  workflow fixture and is <= 55 lines.
- The previous mixed `bindings.test.ts` is absent; all six existing scenarios
  remain covered exactly once. Core typecheck/tests/evaluation and the full
  project evaluator remain green.

### Non-goals

- Changing folder-event binding, legacy path replacement, runtime parameter
  resolution, structured HTTP response mapping, transform table grouping,
  Gmail message binding, fixtures, test assertions, test data, or public
  imports.
- Refactoring production workflow binding code or unrelated tests in this
  slice.

### Baseline

- `workflow/bindings.test.ts` is 271 lines and combines folder-to-Slack,
  structured HTTP/transform-table, and Gmail trigger binding scenarios; the
  focused binding modules and shared fixture are absent. The existing binding
  suite passes 6/6, and Core typecheck/tests/evaluation, document-engine,
  desktop typecheck/build, architecture, and whitespace checks pass.

### Final (2026-09-03T12:58:30.6077129+09:00)

- The mixed binding suite was split into `bindings/file-to-slack.test.ts` (74
  lines), `bindings/structured-transform.test.ts` (117 lines),
  `bindings/gmail.test.ts` (51 lines), and shared `bindings/fixtures.ts` (43
  lines); the previous mixed file is absent.
- All six binding scenarios remain present exactly once, and the focused
  suites pass 6/6. The full project evaluator passes: 193 test files, 717
  passed, 3 skipped; document-engine 39/39; desktop typecheck/build,
  architecture, and whitespace checks pass.
- Production binding behavior, test assertions, data, and public imports were
  not changed.

## Current structural task: trigger-engine polling test split (phase 178)

Split the mixed `runtime/trigger-engine.test.ts` scenarios into polling
initialization/cursor recovery, execution/checkpoint behavior, and event
filtering/inactive-work eligibility modules. Preserve every test body, shared
fixture, assertion, and trigger behavior; this is a test-organization-only
change.

### Success criteria

- `runtime/trigger-engine/poll/initialization.test.ts` contains first-poll
  baseline and malformed-cursor recovery coverage and is <= 125 lines.
- `runtime/trigger-engine/poll/execution.test.ts` contains failed-execution
  cursor behavior and in-flight stop checkpoint coverage and is <= 135 lines.
- `runtime/trigger-engine/poll/eligibility.test.ts` contains event filtering
  and inactive-work coverage and is <= 90 lines.
- `runtime/trigger-engine/poll/fixtures.ts` contains the shared Gmail workflow
  fixture and is <= 45 lines.
- The previous mixed `trigger-engine.test.ts` is absent; all six existing
  scenario blocks and both parameterized cases remain covered exactly once.
  Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing polling initialization, cursor recovery, execution retry/checkpoint
  behavior, event filtering, inactive-work eligibility, fixtures, test
  assertions, test data, or public imports.
- Refactoring production trigger-engine code or unrelated tests in this
  slice.

### Baseline

- `runtime/trigger-engine.test.ts` is 273 lines and combines polling
  initialization/cursor recovery, execution/checkpoint behavior, and
  filtering/inactive-work eligibility; the focused modules and shared Gmail
  fixture are absent. The existing polling suite passes 8/8, and Core
  typecheck/tests/evaluation, document-engine, desktop typecheck/build,
  architecture, and whitespace checks pass.

### Final (2026-09-03T12:51:48.1097777+09:00)

- The mixed polling suite was split into `poll/initialization.test.ts` (99
  lines), `poll/execution.test.ts` (107 lines), `poll/eligibility.test.ts` (64
  lines), and shared `poll/fixtures.ts` (26 lines); the previous mixed file is
  absent.
- All six polling scenario blocks and both parameterized cases remain present
  exactly once, and the focused suites pass 8/8. The full project evaluator
  passes: 191 test files, 717 passed, 3 skipped; document-engine 39/39;
  desktop typecheck/build, architecture, and whitespace checks pass.
- Production trigger behavior, test assertions, data, and public imports were
  not changed.

## Current structural task: push trigger test split (phase 177)

Split the mixed `runtime/trigger-engine/push.test.ts` scenarios into
Slack/local-folder push boundaries, webhook lifecycle behavior, and webhook
startup failure coverage. Preserve every test body, helper, fixture,
assertion, and trigger behavior; this is a test-organization-only change.

### Success criteria

- `runtime/trigger-engine/push/slack-folder.test.ts` contains Slack and local
  folder push-trigger coverage and is <= 130 lines.
- `runtime/trigger-engine/push/webhook.test.ts` contains enabled/disabled,
  authorization, idempotency, stop, and restart webhook coverage and is <=
  160 lines.
- `runtime/trigger-engine/push/webhook-failure.test.ts` contains occupied-port
  listener startup failure coverage and is <= 80 lines.
- `runtime/trigger-engine/push/fixtures.ts` contains the shared listener
  helpers and is <= 50 lines.
- The previous mixed `push.test.ts` is absent; all four existing scenarios
  remain covered exactly once. Core typecheck/tests/evaluation and the full
  project evaluator remain green.

### Non-goals

- Changing Slack or local-folder cursor behavior, webhook authorization,
  idempotency, activation, restart, listener error handling, fixtures, test
  assertions, test data, or public imports.
- Refactoring production trigger-engine code or unrelated tests in this
  slice.

### Baseline

- `runtime/trigger-engine/push.test.ts` is 295 lines and combines Slack,
  local-folder, webhook lifecycle, and listener startup failure scenarios; the
  focused push modules and shared fixture are absent. The existing push suite
  passes 4/4, and Core typecheck/tests/evaluation, document-engine, desktop
  typecheck/build, architecture, and whitespace checks pass.

### Final (2026-09-03T12:43:03.4100102+09:00)

- The mixed push suite was split into `push/slack-folder.test.ts` (112 lines),
  `push/webhook.test.ts` (138 lines), `push/webhook-failure.test.ts` (45
  lines), and shared `push/fixtures.ts` (23 lines); the previous mixed file is
  absent.
- All four existing push scenarios remain present exactly once, and the
  focused suites pass 4/4. The full project evaluator passes: 189 test files,
  717 passed, 3 skipped; document-engine 39/39; desktop typecheck/build,
  architecture, and whitespace checks pass.
- Production trigger behavior, test assertions, data, and public imports were
  not changed.

## Current structural task: discovery recovery test split (phase 176)

Split the mixed `work-discovery/service/recovery.test.ts` scenarios into
persisted-checkpoint recovery and recovery guard/retry modules. Preserve every
test body, fixture, assertion, and discovery behavior; this is a
test-organization-only change.

### Success criteria

- `work-discovery/service/recovery/checkpoint.test.ts` contains persisted
  snapshot recovery and failed automatic recovery retry coverage and is <=
  220 lines.
- `work-discovery/service/recovery/guards.test.ts` contains recovery-attempt
  exhaustion, terminal-session protection, and stale manual retry conflict
  coverage and is <= 130 lines.
- The previous mixed `recovery.test.ts` is absent; all five existing scenario
  blocks and both parameterized cases remain covered exactly once. Core
  typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing checkpoint recovery, snapshot reads, retry behavior, recovery
  exhaustion, terminal-session protection, conflict handling, fixtures, test
  assertions, test data, or public imports.
- Refactoring production work-discovery code or unrelated tests in this slice.

### Baseline

- `work-discovery/service/recovery.test.ts` is 303 lines and combines two
  checkpoint/retry scenarios with three guard/conflict scenarios; the focused
  recovery directory is absent and the existing suite passes 6/6. Core
  typecheck/tests/evaluation, document-engine, desktop typecheck/build,
  architecture, and whitespace checks pass.

### Final (2026-09-03T12:29:22.1936930+09:00)

- The mixed recovery suite was split into `recovery/checkpoint.test.ts` (211
  lines) and `recovery/guards.test.ts` (108 lines); the previous mixed file is
  absent.
- All five recovery scenario blocks and both parameterized cases remain
  present exactly once, and the focused suites pass 6/6. The full project
  evaluator passes: 187 test files, 717 passed, 3 skipped; document-engine
  39/39; desktop typecheck/build, architecture, and whitespace checks pass.
- Production recovery behavior, fixtures, assertions, and public imports were
  not changed.

## Current structural task: command discovery/repair test split (phase 175)

Split the mixed `agent/commands/service/discovery-repair.test.ts` scenarios
into source discovery/policy/result explanation and repair mutation-boundary
modules. Preserve every test body, fixture, assertion, and command behavior;
this is a test-organization-only change.

### Success criteria

- `agent/commands/service/discovery.test.ts` contains source discovery,
  untrusted-data policy, and result-quality explanation coverage and is <= 140
  lines.
- `agent/commands/service/repair.test.ts` contains repair inspect/apply and
  rejection-boundary coverage with its repair fixture and is <= 230 lines.
- The previous mixed `discovery-repair.test.ts` is absent; all five existing
  scenarios remain covered exactly once. Core typecheck/tests/evaluation and
  the full project evaluator remain green.

### Non-goals

- Changing source discovery, local-folder policy, execution explanation,
  repair inspection/application/rejection, fixtures, test assertions, test
  data, or public imports.
- Refactoring production command service code or unrelated tests in this
  slice.

### Baseline

- `agent/commands/service/discovery-repair.test.ts` is 320 lines and combines
  three discovery/policy/explanation scenarios with two repair scenarios; the
  focused modules are absent and the existing suite passes 5/5. Core
  typecheck/tests/evaluation, document-engine, desktop typecheck/build,
  architecture, and whitespace checks pass.

### Final (2026-09-03T12:23:36.5979131+09:00)

- The mixed command-service suite was split into `discovery.test.ts` (124
  lines) and `repair.test.ts` (211 lines); the previous mixed file is absent.
- All five discovery/repair scenarios remain present exactly once, and the
  focused suites pass 5/5. Production code, fixtures, assertions, and command
  behavior were not changed.
- Core typecheck/tests/evaluation, document-engine tests (39/39), desktop
  typecheck/build, architecture check, and `git diff --check` all pass.

## Current structural task: approval continuation runtime test split (phase 174)

Split the remaining mixed `runtime/engine/approval-resume.test.ts` scenarios
into continuation behavior, required-parameter validation, and corrupt/orphan
state modules. Preserve every test body, fixture, assertion, and runtime
behavior; this is a test-organization-only change.

### Success criteria

- `runtime/engine/approval/continuation.test.ts` contains happy-path,
  branch-resume, global-off, and approval-bypass coverage and is <= 240 lines.
- `runtime/engine/approval/validation.test.ts` contains missing Gmail body and
  required-recipient validation coverage and is <= 100 lines.
- `runtime/engine/approval/corrupt-state.test.ts` contains orphan execution,
  invalid snapshot/log, and approval-action validation coverage and is <= 180
  lines.
- The previous mixed `approval-resume.test.ts` is absent; all eleven existing
  scenario blocks and both parameterized cases remain covered exactly once.
  Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing approval continuation, branch traversal, global execution policy,
  required-parameter validation, fail-closed handling, fixtures, test
  assertions, test data, or public imports.
- Refactoring production runtime code or unrelated tests in this slice.

### Baseline

- `runtime/engine/approval-resume.test.ts` is 467 lines, the focused approval
  directory is absent, and the existing approval continuation suite passes
  13/13. Core typecheck/tests/evaluation, document-engine, desktop
  typecheck/build, architecture, and whitespace checks pass.

### Final (2026-09-03T12:17:43.3409013+09:00)

- The mixed approval continuation suite was split into
  `approval/continuation.test.ts` (231 lines), `approval/validation.test.ts`
  (89 lines), and `approval/corrupt-state.test.ts` (171 lines); the previous
  mixed file is absent.
- All eleven scenario blocks and both parameterized cases remain present in
  the focused suites, which pass 13/13. Production code, fixtures, assertions,
  and approval behavior were not changed.
- Core typecheck/tests/evaluation, document-engine tests (39/39), desktop
  typecheck/build, architecture check, and `git diff --check` all pass.

## Current structural task: workflow lifecycle command test split (phase 173)

Split the remaining mixed `agent/commands/service/workflow-lifecycle.test.ts`
scenarios into workflow-definition, saved-workflow execution, and one-shot
queue modules. Preserve every test body, fixture, assertion, and command
service behavior; this is a test-organization-only change.

### Success criteria

- `agent/commands/service/workflow-definition.test.ts` contains versioned
  create/update/delete and catalog contract normalization coverage and is <=
  170 lines.
- `agent/commands/service/execution.test.ts` contains saved-workflow run and
  agent command lifecycle coverage and is <= 130 lines.
- `agent/commands/service/one-shot.test.ts` contains one-shot validation,
  target-card, selection, and chat-session queue coverage and is <= 210 lines.
- The previous mixed `workflow-lifecycle.test.ts` is absent; all nine existing
  scenarios remain covered exactly once. Core typecheck/tests/evaluation and
  the full project evaluator remain green.

### Non-goals

- Changing workflow create/update/delete semantics, catalog normalization,
  runtime injection, one-shot target selection, queue behavior, fixtures, test
  assertions, test data, or public imports.
- Refactoring production command service code or unrelated tests in this
  slice.

### Baseline

- `agent/commands/service/workflow-lifecycle.test.ts` is 372 lines, the
  focused definition, execution, and one-shot modules are absent, and the
  existing workflow lifecycle suite passes 9/9. Core typecheck/tests/evaluation,
  document-engine, desktop typecheck/build, architecture, and whitespace
  checks pass.

### Final (2026-09-03T12:08:26.6551823+09:00)

- The mixed workflow lifecycle suite was split into
  `workflow-definition.test.ts` (130 lines), `execution.test.ts` (85 lines),
  and `one-shot.test.ts` (179 lines); the previous mixed file is absent.
- All nine existing scenarios remain present exactly once across the focused
  suites, and the focused workflow lifecycle tests pass 9/9. Production code,
  fixtures, assertions, and behavior were not changed.
- Core typecheck/tests/evaluation, document-engine tests (39/39), desktop
  typecheck/build, architecture check, and `git diff --check` all pass.

## Current structural task: command service test boundary split (phase 172)

Split the remaining mixed `agent/commands/service.test.ts` scenarios into
catalog/lifecycle, host/context boundary, presentation validation, and read
gateway modules. Preserve every test body, fixture, assertion, and command
service behavior; this is a test-organization-only change.

### Success criteria

- `agent/commands/service/catalog.test.ts` contains command catalog,
  connection listing, and lifecycle coverage and is <= 160 lines.
- `agent/commands/service/boundary.test.ts` contains host and context update
  boundary coverage and is <= 110 lines.
- `agent/commands/service/presentation.test.ts` contains missing-argument and
  presentation validation coverage and is <= 110 lines.
- `agent/commands/service/reads.test.ts` contains capability/source read
  gateway and response-redaction coverage and is <= 190 lines.
- `agent/commands/service/fixtures.ts` contains only shared command context
  setup and is <= 40 lines.
- The previous mixed `service.test.ts` is absent; all twelve existing
  scenarios remain covered exactly once. Core typecheck/tests/evaluation and
  the full project evaluator remain green.

### Non-goals

- Changing command catalog, connection redaction, lifecycle policy, host or
  context boundaries, presentation validation, read gateway behavior, test
  assertions, test data, or public imports.
- Refactoring production command service code or unrelated tests in this
  slice.

### Baseline

- `agent/commands/service.test.ts` is 362 lines, the focused catalog,
  boundary, presentation, reads, and fixture modules are absent, and the
  existing command service suite passes 12/12. Core typecheck/tests/evaluation,
  document-engine, desktop typecheck/build, architecture, and whitespace
  checks pass.

### Final (2026-09-03T11:59:50.2625984+09:00)

- The former mixed 362-line command service suite is now four focused suites:
  catalog/lifecycle `130` lines, host/context boundary `70` lines,
  presentation validation `58` lines, and read gateways `138` lines, with a
  shared context fixture at `2` lines. The previous mixed suite is absent.
- All twelve command service scenarios remain covered exactly once; focused
  suites pass `12/12`.
- Core typecheck/tests/evaluation, document-engine tests, desktop
  typecheck/build, architecture check, and `git diff --check` all pass.

## Current structural task: AI decision test boundary refinement (phase 171)

Refine the remaining 439-line AI decision suite into focused investigation
flow, privacy policy, and evidence/binding modules. Preserve every test body,
provider fixture, assertion, and AI investigation behavior; this remains a
test-organization-only change.

### Success criteria

- `runtime/ai-investigation/decision/investigation-flow.test.ts` contains
  investigation-disabled, additional-read, and incomplete-conclusion coverage
  and is <= 180 lines.
- `runtime/ai-investigation/decision/privacy-policy.test.ts` contains the
  cloud/email/document policy coverage and is <= 300 lines.
- `runtime/ai-investigation/decision/evidence.test.ts` contains PDF image and
  explicit-binding coverage and is <= 180 lines.
- `runtime/ai-investigation/decision/fixtures.ts` contains shared provider and
  workflow/context setup and is <= 140 lines.
- The previous mixed `decision.test.ts` is absent; all ten existing scenarios
  remain covered exactly once. Core typecheck/tests/evaluation and the full
  project evaluator remain green.

### Non-goals

- Changing AI investigation, privacy policy, evidence loading, explicit
  binding, provider behavior, fixtures, test assertions, test data, or public
  imports.
- Refactoring production AI investigation code or unrelated tests in this
  slice.

### Baseline

- `runtime/ai-investigation/decision.test.ts` is 439 lines, the focused
  decision directory modules are absent, and the existing AI decision suite
  passes 10/10. Core typecheck/tests/evaluation, document-engine, desktop
  typecheck/build, architecture, and whitespace checks pass.

### Final (2026-09-03T11:52:19.1787313+09:00)

- The former mixed 439-line decision suite is now three focused suites:
  investigation flow `97` lines, privacy policy `184` lines, and evidence /
  binding `88` lines, with shared provider/workflow/context fixtures at `102`
  lines. The previous mixed suite is absent.
- All ten AI decision scenarios remain covered exactly once; focused suites
  pass `10/10`.
- Core typecheck/tests/evaluation, document-engine tests, desktop
  typecheck/build, architecture check, and `git diff --check` all pass.

## Current structural task: runtime engine test boundary split (phase 170)

Split the remaining mixed `runtime/engine.test.ts` scenarios into focused
execution lifecycle, execution observability/queue, control-flow, and output
binding modules. Preserve every test body, provider fixture, assertion, and
runtime behavior; this is a test-organization-only change.

### Success criteria

- `runtime/engine/execution-lifecycle.test.ts` contains lifecycle, schema,
  cancellation, ephemeral-run, and connector replacement coverage and is <=
  240 lines.
- `runtime/engine/execution-observability.test.ts` contains external approval,
  queue serialization, progress persistence, and observer-isolation coverage
  and is <= 220 lines.
- `runtime/engine/control-flow.test.ts` contains branch selection and
  condition-driven execution coverage and is <= 260 lines.
- `runtime/engine/output-binding.test.ts` contains AI-to-Slack binding and
  approval-boundary coverage and is <= 230 lines.
- The original mixed suite is absent; all sixteen existing scenarios remain
  covered exactly once. Core typecheck/tests/evaluation and the full project
  evaluator remain green.

### Non-goals

- Changing runtime execution, approval, queue, progress, observer, branch,
  condition, binding, provider behavior, fixtures, test assertions, test data,
  or public imports.
- Refactoring production runtime code or unrelated tests in this slice.

### Baseline

- `runtime/engine.test.ts` is 717 lines, the four focused modules are absent,
  and the existing runtime engine suite passes 16/16. Core typecheck/tests,
  evaluation, document-engine, desktop typecheck/build, architecture, and
  whitespace checks pass.

### Final (2026-09-03T11:41:47.4135240+09:00)

- The former mixed 717-line suite is now four focused modules: execution
  lifecycle `194` lines, execution observability `182` lines, control-flow
  `198` lines, and output binding `160` lines. The original mixed suite is
  absent.
- All sixteen runtime engine scenarios remain covered exactly once; focused
  suites pass `16/16`.
- Core typecheck/tests/evaluation, document-engine tests, desktop
  typecheck/build, architecture check, and `git diff --check` all pass.

## Current structural task: condition evaluation test boundary split (phase 169)

Split the mixed condition-expression tests into focused evaluation semantics
and condition normalization/migration modules. Preserve every test body,
fixture value, assertion, and condition behavior; this is a
test-organization-only change.

### Success criteria

- `runtime/condition-eval/evaluation.test.ts` contains declarative evaluation,
  references, null/missing values, and numeric comparison coverage and is <= 90
  lines.
- `runtime/condition-eval/normalization.test.ts` contains legacy/interview
  condition normalization and invalid-filter coverage and is <= 170 lines.
- The original mixed suite is absent; all fifteen existing scenarios remain
  covered exactly once. Core typecheck/tests/evaluation and the full project
  evaluator remain green.

### Non-goals

- Changing condition evaluation, reference fallback rules, numeric coercion,
  migration aliases, normalization, invalid-filter handling, fixtures, test
  assertions, test data, or public imports.
- Refactoring production condition code or unrelated tests in this slice.

### Baseline

- `runtime/condition-eval.test.ts` was 214 lines, the focused evaluation and
  normalization modules were absent, and the existing condition-expression
  suite passed 15/15. Core typecheck/tests/evaluation, document-engine,
  desktop typecheck/build, architecture, and whitespace checks passed.

### Final (2026-09-03T11:28:56.3923198+09:00)

- `runtime/condition-eval/evaluation.test.ts` is 74 lines and contains the
  five evaluation scenarios; `normalization.test.ts` is 144 lines and contains
  the ten normalization/migration scenarios. The mixed original suite is
  absent.
- Test names, fixtures, assertions, condition data, and behavior were
  preserved; focused condition-expression tests pass 15/15.
- Core typecheck/tests/evaluation, document-engine tests, desktop
  typecheck/build, architecture check, and `git diff --check` all pass.

## Current structural task: workspace source service test boundary split (phase 168)

Split the mixed WorkspaceSourceService tests into focused ingest/read,
lifecycle/failure, and session/artifact-cleanup modules, with the shared mock
document engine in a test-only fixture module. Preserve every test body,
fixture value, assertion, cleanup hook, and source-service behavior; this is a
test-organization-only change.

### Success criteria

- `store/workspace-source-service/ingestion.test.ts` contains bounded ingest,
  read, and session ownership coverage and is <= 120 lines.
- `store/workspace-source-service/lifecycle.test.ts` contains processing and
  failed-ingest lifecycle coverage and is <= 150 lines.
- `store/workspace-source-service/artifacts.test.ts` contains session creation
  and artifact garbage-collection coverage and is <= 120 lines.
- `store/workspace-source-service/fixtures.ts` contains only shared mock
  document-engine setup and is <= 60 lines.
- The original mixed suite is absent; all five existing scenarios remain
  covered exactly once. Core typecheck/tests/evaluation and the full project
  evaluator remain green.

### Non-goals

- Changing source attachment, bounded reads, ownership checks, ingest status,
  failure persistence, session creation, artifact GC, fixtures, test
  assertions, test data, or public imports.
- Refactoring production source-service or document-engine code in this slice.

### Baseline (2026-09-03T11:21:11.9598225+09:00)

- `store/workspace-source-service.test.ts` is 223 lines and combines bounded
  ingest/read, processing/failure lifecycle, session creation, and artifact GC;
  the focused directory is absent.
- The existing WorkspaceSourceService suite passes 5/5; Core typecheck/tests,
  evaluation, document-engine, desktop typecheck/build, architecture, and
  whitespace checks pass.

### Final (2026-09-03T11:24:09.7492929+09:00)

- The former mixed 223-line suite is now four focused modules:
  `ingestion.test.ts` `61` lines, `lifecycle.test.ts` `88` lines,
  `artifacts.test.ts` `75` lines, and shared `fixtures.ts` `29` lines.
- All five WorkspaceSourceService scenarios remain covered exactly once;
  focused suites pass `5/5`.
- Core typecheck/tests/evaluation, document-engine tests, desktop
  typecheck/build, architecture check, and `git diff --check` all pass.

## Current structural task: North Star QA test boundary split (phase 167)

Split the mixed North Star QA suite into chat/data-safety, runtime/approval,
and connector-failure modules, with shared test providers and workflow setup in
a test-only fixture module. Preserve every test body, fixture value, assertion,
cleanup hook, and QA behavior; this is a test-organization-only change.

### Success criteria

- `north-star/north-star-qa/chat-safety.test.ts` contains plain-chat and cloud
  data-safety coverage and is <= 180 lines.
- `north-star/north-star-qa/runtime-safety.test.ts` contains ephemeral,
  activation, approval, and duplicate-resume coverage and is <= 150 lines.
- `north-star/north-star-qa/connector-failure.test.ts` contains HTTP connector
  failure logging coverage and is <= 80 lines.
- `north-star/north-star-qa/fixtures.ts` contains only shared QA providers and
  workflow setup and is <= 80 lines.
- The original mixed suite is absent; all ten existing scenarios remain
  covered exactly once. Core typecheck/tests/evaluation and the full project
  evaluator remain green.

### Non-goals

- Changing QA scenarios, connector policy, cloud redaction, approval
  semantics, execution behavior, dynamic catalog cleanup, document-engine
  cleanup, fixtures, test assertions, test data, or public imports.
- Refactoring production code or unrelated tests in this slice.

### Baseline (2026-09-03T11:15:21.3380807+09:00)

- `north-star/north-star-qa.test.ts` is 243 lines and combines four
  chat/data-safety scenarios, four runtime/approval scenarios, one cloud
  redaction scenario, and one connector-failure scenario; the focused
  directory is absent.
- The existing North Star QA suite passes 10/10; Core typecheck/tests,
  evaluation, document-engine, desktop typecheck/build, architecture, and
  whitespace checks pass.

### Final (2026-09-03T11:18:29.3834053+09:00)

- The former mixed 243-line suite is now four focused modules:
  `chat-safety.test.ts` `111` lines, `runtime-safety.test.ts` `77` lines,
  `connector-failure.test.ts` `32` lines, and shared `fixtures.ts` `42` lines.
- All ten North Star QA scenarios remain covered exactly once; focused suites
  pass `10/10`.
- Core typecheck/tests/evaluation, document-engine tests, desktop
  typecheck/build, architecture check, and `git diff --check` all pass.

## Current structural task: work-discovery E2E test boundary split (phase 166)

Split the mixed Work Discovery E2E test into the end-to-end publish/run flow
and focused correctness regressions, with the shared XLSX writer in a test-only
fixture module. Preserve every test body, fixture value, assertion, timeout,
and discovery behavior; this is a test-organization-only change.

### Success criteria

- `testing/e2e/work-discovery-e2e/flow.test.ts` contains the discovery,
  publish, compile, and new-data execution flow and is <= 170 lines.
- `testing/e2e/work-discovery-e2e/correctness.test.ts` contains the five
  candidate/replay/observation correctness regressions and is <= 180 lines.
- `testing/e2e/work-discovery-e2e/fixtures.ts` contains only shared XLSX test
  setup and is <= 40 lines.
- The original mixed suite is absent; all six existing scenarios remain
  covered exactly once. Core typecheck/tests/evaluation and the full project
  evaluator remain green.

### Non-goals

- Changing Work Discovery lifecycle, candidate ranking/replay, clarification,
  workbook observation, workflow compilation/execution, fixtures, test
  assertions, timeouts, test data, or public imports.
- Refactoring production discovery code or unrelated tests in this slice.

### Baseline (2026-09-03T11:08:03.4079379+09:00)

- `testing/e2e/work-discovery-e2e.test.ts` is 283 lines and combines one
  discovery/publish/run flow with five correctness regressions; the focused
  directory is absent.
- The existing Work Discovery E2E suite passes 6/6; Core typecheck/tests,
  evaluation, document-engine, desktop typecheck/build, architecture, and
  whitespace checks pass.

### Final (2026-09-03T11:11:49.4444254+09:00)

- The former mixed 283-line suite is now three focused modules: `flow.test.ts`
  `112` lines, `correctness.test.ts` `167` lines, and shared `fixtures.ts`
  `8` lines.
- All six Work Discovery E2E scenarios remain covered exactly once; focused
  suites pass `6/6`, including the 20-second publish/run flow.
- Core typecheck/tests/evaluation, document-engine tests, desktop
  typecheck/build, architecture check, and `git diff --check` all pass.

## Current structural task: HTTP connector test boundary split (phase 165)

Split the mixed HTTP connector tests into focused method/response behavior and
connection-selection modules. Preserve every test body, fixture value,
assertion, and HTTP connector behavior; this is a test-organization-only
change.

### Success criteria

- `modules/http/connector/methods.test.ts` contains GET/POST methods,
  response/error details, and method guard coverage and is <= 210 lines.
- `modules/http/connector/connection-selection.test.ts` contains saved
  connection selection and explicit-connection requirements and is <= 100
  lines.
- The original mixed suite is absent; all ten existing scenarios remain
  covered exactly once. Core typecheck/tests/evaluation and the full project
  evaluator remain green.

### Non-goals

- Changing HTTP fetch behavior, response limits, error details, method guards,
  base URL resolution, connection selection, fixtures, test assertions, test
  data, or public imports.
- Refactoring production HTTP code or unrelated tests in this slice.

### Baseline (2026-09-03T11:02:36.1818524+09:00)

- `modules/http/connector.test.ts` is 240 lines and combines seven
  method/response/guard scenarios with three connection-selection scenarios;
  the focused directory is absent.
- The existing HTTP connector suite passes 10/10; Core typecheck/tests,
  evaluation, document-engine, desktop typecheck/build, architecture, and
  whitespace checks pass.

### Final (2026-09-03T11:05:17.2977084+09:00)

- The former mixed 240-line suite is now two focused modules:
  `methods.test.ts` `184` lines and `connection-selection.test.ts` `64` lines.
- All ten HTTP connector scenarios remain covered exactly once; focused suites
  pass `10/10`.
- Core typecheck/tests/evaluation, document-engine tests, desktop
  typecheck/build, architecture check, and `git diff --check` all pass.

## Current structural task: workspace chat repository test boundary split (phase 164)

Split the mixed workspace-chat repository tests into focused transcript,
execution/mapping, title/source metadata, and deletion modules. Preserve every
test body, fixture value, assertion, and persistence behavior; this is a
test-organization-only change.

### Success criteria

- `store/workspace-chat-repository/transcript.test.ts` contains transcript
  validation, corrupt-row, round-trip, and presentation coverage and is <= 110
  lines.
- `store/workspace-chat-repository/execution.test.ts` contains execution-result
  merge and workflow-mapping coverage and is <= 110 lines.
- `store/workspace-chat-repository/metadata.test.ts` contains source-derived
  title and source-count coverage and is <= 70 lines.
- `store/workspace-chat-repository/deletion.test.ts` contains cascade deletion
  and rollback/failure coverage and is <= 70 lines.
- The original mixed suite is absent; all twelve existing scenarios remain
  covered exactly once. Core typecheck/tests/evaluation and the full project
  evaluator remain green.

### Non-goals

- Changing chat validation, corrupt-row handling, memo/workflow metadata,
  execution-result merging, source-derived titles, SQL, deletion semantics,
  fixtures, test assertions, test data, or public imports.
- Refactoring production repositories or unrelated tests in this slice.

### Baseline (2026-09-03T10:56:36.6228037+09:00)

- `store/workspace-chat-repository.test.ts` is 252 lines and combines five
  transcript/presentation scenarios, three execution/mapping scenarios, two
  title/source scenarios, and two deletion scenarios; the focused directory is
  absent.
- The existing workspace-chat repository suite passes 12/12; Core
  typecheck/tests, evaluation, document-engine, desktop typecheck/build,
  architecture, and whitespace checks pass.

### Final (2026-09-03T10:59:52.8082772+09:00)

- The former mixed 252-line suite is now four focused modules:
  `transcript.test.ts` `91` lines, `execution.test.ts` `80` lines,
  `metadata.test.ts` `45` lines, and `deletion.test.ts` `51` lines.
- All twelve workspace-chat repository scenarios remain covered exactly once;
  focused suites pass `12/12`.
- Core typecheck/tests/evaluation, document-engine tests, desktop
  typecheck/build, architecture check, and `git diff --check` all pass.

## Current structural task: manual-run input test boundary split (phase 163)

Split the mixed manual-run input tests into focused folder-selection,
validation/enrichment, and template-resolution modules, with shared workflow
setup in a test-only fixture module. Preserve every test body, fixture value,
assertion, and manual-run behavior; this is a test-organization-only change.

### Success criteria

- `runtime/manual-run-input/folder-selection.test.ts` contains connected-folder
  precedence, fallback, extension, and ambiguity coverage and is <= 180 lines.
- `runtime/manual-run-input/validation.test.ts` contains manual-input
  validation and Gmail enrichment coverage and is <= 160 lines.
- `runtime/manual-run-input/templates.test.ts` contains template resolution
  coverage and is <= 80 lines.
- `runtime/manual-run-input/fixtures.ts` contains only shared workflow setup
  and is <= 50 lines.
- The original mixed suite is absent; all eleven existing scenarios remain
  covered exactly once. Core typecheck/tests/evaluation and the full project
  evaluator remain green.

### Non-goals

- Changing folder precedence, extension inference, Gmail lookup, validation
  errors, template resolution, fixtures, test assertions, test data, or public
  imports.
- Refactoring production runtime or unrelated tests in this slice.

### Baseline (2026-09-03T10:46:54.7355265+09:00)

- `runtime/manual-run-input.test.ts` is 253 lines and combines seven folder
  selection scenarios, two validation scenarios, Gmail enrichment, and
  template resolution; the focused directory is absent.
- The existing manual-run input suite passes 11/11; Core typecheck/tests,
  evaluation, document-engine, desktop typecheck/build, architecture, and
  whitespace checks pass.

### Final (2026-09-03T10:51:44.1780726+09:00)

- The former mixed 253-line suite is now four focused modules:
  `folder-selection.test.ts` `137` lines, `validation.test.ts` `85` lines,
  `templates.test.ts` `15` lines, and `fixtures.ts` `21` lines.
- All eleven manual-run input scenarios remain covered exactly once; focused
  suites pass `11/11`.
- Core typecheck/tests/evaluation, document-engine tests, desktop
  typecheck/build, architecture check, and `git diff --check` all pass.

## Current structural task: Gmail poll test boundary split (phase 159)

Split the Gmail new-message polling tests into focused history/cursor and
message/error-boundary modules. Preserve every test body, fixture value,
assertion, and polling behavior; this is a test-organization-only change.

### Success criteria

- `modules/gmail/new-message-poll/history.test.ts` contains history paging and
  cycle protection coverage and is <= 180 lines.
- `modules/gmail/new-message-poll/inbox-filter.test.ts` contains inbox
  filtering coverage and is <= 100 lines.
- `modules/gmail/new-message-poll/errors.test.ts` contains deleted-message and
  non-404 error propagation coverage and is <= 180 lines.
- The seven existing Gmail polling scenarios remain covered exactly once;
  Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing Gmail polling, cursor, deduplication, message filtering, error
  classification, fixtures, test assertions, test data, or public imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Final (2026-09-03T10:17:58.5921140+09:00)

- The former mixed 297-line suite is now three focused modules: history
  `137` lines, inbox filtering `53` lines, and message/error boundaries
  `117` lines.
- All seven Gmail polling scenarios remain covered exactly once; the focused
  suites pass `7/7`.
- Core typecheck/tests/evaluation, document-engine tests, desktop
  typecheck/build, architecture check, and `git diff --check` all pass.

## Current structural task: Webhook listener test boundary split (phase 160)

Split the Webhook inbound listener tests into focused accepted-request,
request-validation/rejection, and lifecycle modules. Preserve every test body,
fixture value, assertion, cleanup behavior, and listener security/transport
behavior; this is a test-organization-only change.

### Success criteria

- `triggers/webhook/listener/acceptance.test.ts` contains accepted delivery,
  authentication-header filtering, idempotency, host, and path coverage and is
  <= 220 lines.
- `triggers/webhook/listener/rejection.test.ts` contains rejected request and
  payload-limit coverage and is <= 220 lines.
- `triggers/webhook/listener/lifecycle.test.ts` contains restart coverage and
  is <= 120 lines.
- The original mixed listener suite is absent; all existing Webhook listener
  scenarios remain covered exactly once. Core typecheck/tests/evaluation and
  the full project evaluator remain green.

### Non-goals

- Changing listener routing, authentication, header redaction, path decoding,
  body draining, payload limits, startup/restart behavior, fixtures, test
  assertions, test data, or public imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Final (2026-09-03T10:27:23.4939054+09:00)

- The former mixed 313-line suite is now three focused modules: acceptance
  `176` lines, rejection `134` lines, and lifecycle `32` lines.
- All Webhook listener scenarios remain covered exactly once; the focused
  suite passes `15/15`.
- Core typecheck/tests/evaluation, document-engine tests, desktop
  typecheck/build, architecture check, and `git diff --check` all pass.

## Current structural task: HTTP request test boundary split (phase 161)

Split the HTTP request tests into focused response-body/transport lifecycle and
request-option/authentication modules. Preserve every test body, fixture value,
assertion, cleanup behavior, and request semantics; this is a
test-organization-only change.

### Success criteria

- `modules/http/request/response-limits.test.ts` contains response streaming,
  size-limit, redirect, HEAD, and UTF-8 coverage and is <= 210 lines.
- `modules/http/request/request-options.test.ts` contains authentication and
  timeout normalization coverage and is <= 120 lines.
- The original mixed request suite is absent; all existing HTTP request
  scenarios remain covered exactly once. Core typecheck/tests/evaluation and
  the full project evaluator remain green.

### Non-goals

- Changing HTTP fetch behavior, response truncation, body cancellation,
  redirect handling, UTF-8 handling, authentication precedence, timeout
  normalization, fixtures, test assertions, test data, or public imports.
- Refactoring unrelated tests or existing dirty worktree changes.

### Final (2026-09-03T10:33:10.6540075+09:00)

- The former mixed 254-line suite is now two focused modules: response limits
  and transport lifecycle `197` lines, request options `66` lines.
- All HTTP request scenarios remain covered exactly once; the focused suite
  passes `19/19`.
- Core typecheck/tests/evaluation, document-engine tests, desktop
  typecheck/build, architecture check, and `git diff --check` all pass.

## Current structural task: contract validator test domain split (phase 154)

Split the mixed contract compatibility, mapper, workflow validation, control
flow, AI-output, and connector/catalog scenarios in
`packages/core/src/workflow/contract-validator.test.ts` into focused test
modules. Move the shared workflow fixture into a test-only fixture module.
Preserve every test body, fixture value, assertion, and validation behavior;
this is a test-organization-only change.

### Success criteria

- `workflow/contract-validator.test.ts` remains focused on compatibility,
  mappers, and schema/trigger validation and is <= 160 lines.
- `workflow/contract-validator/graph.test.ts` contains graph/control-flow
  coverage and is <= 260 lines.
- `workflow/contract-validator/ai-output.test.ts` contains AI-output reference
  coverage and is <= 170 lines.
- `workflow/contract-validator/catalog.test.ts` contains connector/catalog
  coverage and is <= 190 lines.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing contract compatibility, mapper behavior, workflow validation,
  bindings, dynamic catalog behavior, fixtures, test assertions, test data, or
  production imports.
- Refactoring unrelated tests or existing dirty worktree changes.
## Current structural task: agent command service test boundary split (phase 149)

Split command contract/resource tests, workflow lifecycle tests, and source
discovery/repair tests from `packages/core/src/agent/commands/service.test.ts`
into focused test modules. Preserve every test body, assertion, fixture, and
runtime behavior; this is a test-organization-only change.

### Success criteria

- `service.test.ts` remains focused on command contract, resources, capability,
  presentation, context, and guarded read coverage and is <= 480 lines.
- `service/workflow-lifecycle.test.ts` contains workflow mutation/execution and
  one-shot queue coverage and is <= 420 lines.
- `service/discovery-repair.test.ts` contains source discovery and repair
  coverage and is <= 420 lines.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing production command code, command semantics, persistence, fixtures,
  test assertions, test data, or public imports.
- Refactoring unrelated tests or existing dirty worktree changes.
## Current structural task: runtime engine safety-test boundary split (phase 150)

Split connector-missing, output-contract guard, and runtime repair-proposal
scenarios from `packages/core/src/runtime/engine.test.ts` into a focused safety
test module. Preserve every test body, assertion, fixture, and runtime
behavior; this is a test-organization-only change.

### Success criteria

- `runtime/engine.test.ts` remains focused on execution/control-flow behavior
  and is <= 760 lines.
- `runtime/engine/contract-guards.test.ts` contains the extracted safety and
  contract coverage and is <= 260 lines.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing production runtime code, connector behavior, output contracts,
  repair semantics, persistence, fixtures, test assertions, or public imports.
- Refactoring unrelated tests or existing dirty worktree changes.
## Current structural task: workflow binding test boundary split (phase 151)

Split AI-output inference tests and port-binding parsing tests from
`packages/core/src/workflow/bindings.test.ts`, leaving trigger/runtime binding
coverage in the original file. Preserve every test body, assertion, fixture,
and binding behavior; this is a test-organization-only change.

### Success criteria

- `workflow/bindings.test.ts` remains focused on trigger/runtime input binding
  behavior and is <= 320 lines.
- `workflow/bindings/ai-output.test.ts` contains AI-output inference coverage
  and is <= 320 lines.
- `workflow/bindings/ports.test.ts` contains port-binding parsing coverage and
  is <= 60 lines.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing binding implementation, inference rules, parsing behavior, fixtures,
  test assertions, test data, or public imports.
- Refactoring unrelated tests or existing dirty worktree changes.
## Current structural task: AI investigation test boundary split (phase 152)

Split parameter-resolution tests from AI-decision execution tests in
`packages/core/src/runtime/ai-investigation.test.ts` into focused modules.
Preserve every test body, provider fixture, assertion, and investigation
behavior; this is a test-organization-only change.

### Success criteria

- `runtime/ai-investigation.test.ts` remains focused on parameter resolution and
  is <= 110 lines.
- `runtime/ai-investigation/decision.test.ts` contains AI decision execution
  coverage and is <= 400 lines.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing investigation implementation, provider behavior, privacy policy,
  bindings, fixtures, test assertions, test data, or public imports.
- Refactoring unrelated tests or existing dirty worktree changes.
## Current structural task: trigger engine test boundary split (phase 153)

Split Gmail polling/cursor tests from Slack, local-folder, and webhook push
transport tests in `packages/core/src/runtime/trigger-engine.test.ts`.
Move the webhook-only port and listener helpers with the push suite. Preserve
every test body, fixture, assertion, and trigger behavior; this is a
test-organization-only change.

### Success criteria

- `runtime/trigger-engine.test.ts` remains focused on Gmail polling/cursor
  behavior and is <= 360 lines.
- `runtime/trigger-engine/push.test.ts` contains Slack/local-folder/webhook
  transport coverage and is <= 300 lines.
- Core typecheck/tests/evaluation and the full project evaluator remain green.

### Non-goals

- Changing trigger scheduling, cursor semantics, connector behavior, webhook
  listener behavior, fixtures, test assertions, test data, or public imports.
- Refactoring unrelated tests or existing dirty worktree changes.

## Current structural task: execution-result message test boundary split (phase 162)

Split the mixed execution-result message tests into focused projection,
inline-approval, and no-target modules, with shared setup in a test-only
fixture module. Preserve every test body, fixture value, assertion, and
execution-result/chat behavior; this is a test-organization-only change.

### Success criteria

- `runtime/execution-result/projection.test.ts` contains result projection and
  idempotent update coverage and is <= 180 lines.
- `runtime/execution-result/approval.test.ts` contains inline approval
  projection coverage and is <= 160 lines.
- `runtime/execution-result/no-target.test.ts` contains no-target behavior and
  is <= 80 lines.
- `runtime/execution-result/fixtures.ts` contains only shared test setup and
  is <= 80 lines.
- The original mixed suite is absent; all five existing scenarios remain
  covered exactly once. Core typecheck/tests/evaluation and the full project
  evaluator remain green.

### Non-goals

- Changing execution-result formatting, status/error/approval semantics,
  workspace-chat mapping, persistence, fixtures, test assertions, test data,
  or public imports.
- Refactoring production runtime, execution storage, approval repositories,
  workspace chat, or unrelated tests in this slice.

### Baseline (2026-09-03T10:37:08.1045450+09:00)

- `runtime/execution-result-message.test.ts` is 259 lines and combines three
  projection/idempotency scenarios, inline approval projection, and no-target
  behavior; the focused directory is absent.
- The existing execution-result suite passes 5/5; Core typecheck/tests,
  evaluation, document-engine, desktop typecheck/build, architecture, and
  whitespace checks pass.

### Final (2026-09-03T10:43:44.2813526+09:00)

- The former mixed 259-line suite is now four focused modules: projection
  `127` lines, approval `86` lines, no-target `16` lines, and shared fixtures
  `48` lines.
- All five execution-result scenarios remain covered exactly once; focused
  suites pass `5/5`.
- Core typecheck/tests/evaluation, document-engine tests, desktop
  typecheck/build, architecture check, and `git diff --check` all pass.

## Current validation task: Work Discovery multi-seed adversarial sweep

Keep the existing v1, rotating, and adversarial profile contracts unchanged,
then execute the same independent benchmark cases across multiple deterministic
seeds. Store each seed's fixture/report and an aggregate report so a passing
single seed cannot hide a pesticide-paradox failure. Preserve holdout failures
as evidence; do not change production Work Discovery code or rewrite gold
answers to improve the aggregate numbers.

### Success criteria

- A dedicated sweep runner accepts a profile and at least two deterministic
  seeds, with a documented default ten-seed set.
- Every seed gets its own external fixture root and report, while the sweep
  writes one aggregate JSON/Markdown report containing seed-level metrics,
  pooled metrics, safety counts, and seed-qualified failure rows.
- The sweep uses the existing production Core adapter only for evaluation and
  keeps independent case/gold construction in benchmark code.
- `schema-drift`, `source-confusion`, and `input-variation` sweeps pass the
  Full safety gate across all default seeds.
- `expanded` sweep results expose the known B24-B26 holdout-generalization
  failures for every affected seed without hiding or reclassifying them.
- The original v1 and rotating single-seed contracts remain green and no
  production source changes are introduced.

### Non-goals

- Changing production candidate enumeration, replay, evaluator, runtime, or
  connector behavior.
- Treating the known holdout failures as fixture errors or weakening the safety
  gate to make `expanded` pass.
- Adding live Gmail, Slack, HTTP, PostgreSQL, AI-provider, or network calls.
- Replacing Product E2E or document-engine acceptance tests with this sweep.

### Baseline (2026-09-04T10:13:24.1887183+09:00)

- Single-seed adversarial profiles exist and produce reports, but no sweep
  runner, seed-qualified aggregate, or multi-seed evidence exists.
- `expanded` has 30 cases and already exposes Full B24-B26 as holdout
  generalization failures; the baseline must preserve these failures across
  seeds rather than treating them as a regression to hide.
- Production-boundary check remains clean: no Core or Desktop source changes.

### Final (2026-09-04T10:23:08.4920669+09:00)

- Added a dedicated multi-seed sweep with a documented default of 10
  deterministic seeds, per-seed fixture/report roots, and pooled aggregate
  JSON/Markdown plus seed-qualified failure evidence.
- Contract checks passed for all 10 seeds at 30 cases each. The schema-drift
  and input-variation sweeps each passed Full safety at 140/140 cases; the
  source-confusion sweep had 0 Full unsafe publishes across 140 cases while
  exposing a small conservative-clarification gap.
- The expanded sweep evaluated 300 cases. Full correct publish was 98.0%,
  false publish was 13.27%, and safe decision was 88.67%. B24, B25, and B26
  each produced 10 preserved Full holdout-generalization failures; none were
  reclassified or removed.
- v1/rotating regression contracts, Core 331/717/3, eval 11/11, Desktop
  typecheck/build, document-engine 39/39, architecture 1092/3583, syntax,
  production-boundary, and diff checks passed. No production source changed.

## Current correctness task: fail closed when a required observation is missing

The replay runner must not accept a candidate merely because it passes the
examples that happen to contain a required output path. A required path that is
absent from any training example must produce an explicit failed replay, so the
session cannot claim that every example was reproduced.

### Success criteria

- A required observation path missing from one example creates a failed replay
  result for that example and prevents the candidate from being accepted.
- Existing optional-observation behavior remains unchanged.
- Existing truncated-snapshot, multi-example replay, Work Discovery benchmark,
  Core typecheck/tests/evaluation, and project regressions remain green.
- The patch stays within the replay runner, its focused regression test, and
  the harness/evidence records.

### Non-goals

- Adding future holdout data to the product session or pretending an unseen
  future result can be known during discovery.
- Changing candidate enumeration, scoring thresholds, source connectors,
  clarification wording, publish UX, or workflow runtime behavior.
- Rewriting the benchmark's B24-B26 holdout-generalization evidence.

## Current evaluation task: classify hidden-holdout findings and expose metric denominators

Keep hidden holdout examples out of discovery, replay, and publish decisions.
Document whether each B24-B26 mismatch is a benchmark-only generalization or
identifiability finding versus an observable product contract violation, and
make every aggregate metric expose its numerator and denominator.

### Success criteria

- B24-B26 retain their current fixtures and gold outcomes while their failure
  evidence records the discovery inputs, training replay, ambiguity decision,
  publish decision, and hidden holdout result.
- The report exposes numerator, denominator, and eligible-case definitions for
  correct publish, false publish, safe decision, and holdout accuracy.
- Hidden holdout data is never passed to the production Core adapter before the
  discovery decision; it remains an evaluation-only check.
- The missing-required-observation replay regression remains fixed and all
  benchmark, Core, and project checks stay green.

### Non-goals

- Adding a holdout gate, cross-validation feature, or future-data input to the
  product.
- Rewriting expected outcomes or deleting the preserved B24-B26 failures.
- Adding live connectors, network calls, or unrelated product/UI changes.

### Final: replay completeness (2026-09-04T11:02:41.8367913+09:00)

- The focused replay suite passes 3/3, including the new missing-required-
  observation regression and the unchanged optional-observation behavior.
- The minimal production patch is limited to `replay-runner.ts`: a required
  path absent from any training example now creates an explicit failed replay,
  so the candidate cannot be accepted from the remaining examples alone.
- Core typecheck/tests/evaluation, Desktop typecheck/build, document-engine
  39/39, architecture 1092/3583, benchmark contracts, report-boundary checks,
  and `git diff --check` pass. The full Core suite is 331 files with 719 passed
  and 3 skipped.

### Final: hidden-holdout findings (2026-09-04T11:02:41.8367913+09:00)

- B24, B25, and B26 retain their fixtures and gold outcomes and now preserve
  training evidence, candidate replay, publish/ambiguity decision, and hidden
  holdout evidence in the report.
- The 10-seed expanded run remains 300 cases: Full has 196/200 correct
  publishes (98.0%), 30/226 unsafe publishes (13.27%), 266/300 safe decisions
  (88.67%), and 30 hidden-holdout generalization failures. Those failures are
  explicitly marked evaluation-only; hidden holdout was not passed to product
  discovery or publish.
- B24 is classified as `algorithmic_limitation`; B25 and B26 as
  `missing_product_capability`. No holdout gate, cross-validation feature, or
  gold-answer rewrite was added.
- The report boundary verifier also validates pooled metric arithmetic and
  preserves classified B24~B26 evidence for every seed.

## Current evaluation task: freeze Work Discovery Benchmark v1 and extract results

Freeze the already measured Work Discovery benchmark instead of adding more
cases or tuning production behavior against the observed failures. Preserve
the fixture, gold-answer, seed, variant, holdout-boundary, and metric contracts;
write a durable result summary and representative artifact manifest.

### Success criteria

- The final v1, adversarial profiles, and ten-seed aggregate are regenerated
  from the current code and their report-boundary checks pass.
- Core, evaluation, Desktop, document-engine, architecture, syntax, and
  whitespace regressions remain green.
- The final report states metric numerators/denominators and distinguishes
  product bugs from evaluation-only B24~B26 findings.
- The freeze manifest records the representative report and contract hashes.
- No new benchmark case, holdout gate, cross-validation feature, or unrelated
  product behavior is added during the freeze.

### Non-goals

- Improving the frozen benchmark score by changing production behavior.
- Rewriting fixtures, gold answers, seed lists, or preserved failure evidence.
- Treating hidden holdout data as product discovery or publish input.
- Mixing PDF Product E2E or Desktop connector acceptance into Work Discovery
  metrics.

### Final (2026-09-04T11:41:24.3393799+09:00)

- Regenerated v1, rotating, schema-drift, source-confusion, holdout,
  input-variation, and expanded reports from the current Core build.
- Re-ran the three safe ten-seed sweeps and the expanded ten-seed aggregate:
  300 cases, Full 196/200 correct publish, 30/226 false publish, and
  266/300 safe decisions; B24~B26 remained 10 failures each.
- Core 331 files/719 passed/3 skipped, evaluation 11/11, Desktop
  typecheck/build, document-engine 39/39, architecture 1092/3583,
  syntax checks, and diff check passed.
- Added the frozen result summary and representative SHA-256 manifest under
  `docs/evaluation/`. No benchmark or product behavior was tuned for this
  checkpoint.

## Current evaluation task: compare the fourth frozen-v1 ablation condition

Use the already frozen Work Discovery Benchmark v1 inputs to add one
comparison-only condition: `No Replay + No Clarification`. Do not modify the
v1 fixture, gold-answer, seed, holdout, or metric contracts. The existing
three conditions and their reports remain the frozen baseline; the new runner
must write a separate comparison artifact.

### Success criteria

- The same 10 seeds × 30 scenarios are evaluated under Full, No Replay, No
  Clarification, and No Replay + No Clarification.
- The fourth condition is executed through its own no-replay/no-clarification
  path and its outcomes are compared with the existing No Replay path.
- Scenario/seed raw outcomes and an aggregate comparison table are preserved
  outside the repository under `D:\ax\_test`.
- All conditions use the existing metric numerator/denominator definitions.
- The frozen v1 fixture, gold, seed list, existing reports, and manifest are
  not rewritten; no production behavior is changed.

### Non-goals

- Changing `v1` benchmark source files, fixtures, gold answers, or existing
  report artifacts.
- Adding a holdout gate, cross-validation, new product capability, or tuning
  production behavior to improve the comparison.
- Treating the post-decision holdout evaluation as input to any condition.

### Baseline (2026-09-04T11:47:48.9506748+09:00)

- Frozen v1 already has Full, No Replay, and No Clarification over the same
  expanded 10-seed/300-case input.
- No separate fourth-condition raw comparison report exists.
- The existing frozen v1 source/manifest remains unchanged at task start.

### Final (2026-09-04T11:54:18.6709957+09:00)

- Added an additive `ablation.mjs` runner and `test:wd-ablation` script; the
  frozen benchmark runner, fixtures, gold answers, seeds, and manifest were
  not modified.
- Ran the exact expanded 10-seed/300-case input under all four conditions.
  Full remained 196/200 correct publish, 30/226 false publish, and 266/300
  safe decisions. No Replay was 10/200, 290/300, and 200/300 respectively;
  No Clarification was 200/200, 70/270, and 230/300.
- The independent No Replay + No Clarification path matched No Replay for
  300/300 scenarios and all decision metrics; the result is preserved under
  `D:\ax\_test\ablations\v1-expanded-10-seed`.
- The frozen aggregate identity and SHA-256 remained unchanged. Contract,
  equivalence, syntax, diff, and previously completed project regression
  checks pass.

## Current task: external realistic monthly-report fixture

Prepare only an independent, realistic virtual-company environment and
reference documents for a human to test AX Studio manually. The fixture lives
outside the repository under `D:\\ax_test`; AX Studio itself must not be
started, connected, uploaded to, or evaluated by this task.

### Success criteria

- A local REST order/payment API runs independently at `127.0.0.1:43120`,
  requires the documented API key, supports bounded date/status filtering,
  pagination, health, and order detail, and contains deterministic August and
  September 2026 data with realistic status, refund, discount, plan, channel,
  and boundary-date variation.
- A Docker Compose PostgreSQL fixture runs independently at port `55432`,
  exposes customers, contracts, and account managers, and has valid foreign
  keys plus customer IDs that match the REST orders. The REST payload does not
  contain customer enrichment or contract fields.
- A blank A4 Korean report template, a completed August example report, and a
  hidden completed September expected report are produced with the same
  stable layout, readable Korean font, and no clipped content.
- A hidden September metrics JSON is calculated by an independent fixture/gold
  implementation, not by AX, Work Discovery, TransformExpr, or copied product
  code. The August example and September expected report agree with their
  respective source data.
- `D:\\ax_test\\README.md` gives a non-technical manual flow, the exact
  connection values, the two files safe to show AX, the two hidden gold files,
  and one natural-language instruction asking AX to reproduce the August
  reporting style for September.
- Fixture-only validation covers API data/pagination, database SQL/FK shape,
  deterministic independent gold values, source key consistency, and PDF
  rendering. No AX process, Work Discovery run, connector registration,
  production source, or benchmark runner is changed or executed.

### Non-goals

- Testing AX Studio or deciding whether AX discovers the workflow correctly.
- Modifying Core, Desktop, Work Discovery, TransformExpr, or benchmark code.
- Connecting live Gmail, Slack, external REST services, user credentials, or
  any non-loopback endpoint.
- Showing the September expected report or expected metrics to AX during the
  human test.

### Final record (2026-09-04T13:15:02.3617891+09:00)

- The independent fixture is complete under `D:\\ax_test`.
- REST static and live checks, PostgreSQL Compose/FK checks, independent gold
  checks, and rendered PDF checks passed.
- The AX-facing template contains only the fixed form structure; all variable
  values and placeholder tokens are blank.
- The database and REST server were stopped after validation; the user starts
  them only for the manual AX test.
- AX Studio, Work Discovery, connector registration, uploads, benchmark
  execution, and production code were not run or changed by this task.

## Current task: natural-language multi-source command chat completion

Make the user's natural, high-level monthly-report instruction work as a
single coherent AX request when the necessary connected sources and reference
documents are already available. The command chat must not fall back to the
generic "단계가 너무 많아졌습니다" message merely because a valid plan needs
more bounded host commands than the current loop allows.

### Success criteria

- A regression test reproduces the exact max-round symptom with a realistic
  multi-source/report request and fails before the fix.
- The same request completes through a bounded, deterministic command loop
  after the fix, without an unbounded retry loop or a generic max-round
  fallback.
- The command protocol preserves the user's attached reference documents,
  connected HTTP/RDB context, host command results, and safety constraints
  across rounds so the model can keep one coherent plan.
- Existing command access, approval, read-only, session-isolation, protocol,
  and regression tests remain passing.

### Non-goals

- Changing the external manual-test fixture under `D:\\ax_test`.
- Running AX Studio, registering connectors, uploading files, or calling live
  external services as part of the code fix.
- Removing bounded execution or making the loop unlimited.
- Hardcoding this one Korean sentence, source names, report values, or a
  special command sequence.

### Final record (2026-09-04T13:54:59.3025004+09:00)

- The exact natural-language multi-source report request reproduced the generic
  max-round fallback before the fix and completed after the fix.
- The command-chat budget is finite at 16 rounds; no sentence, source, fixture,
  or command-sequence mapping was added.
- The focused regression passed 3/3, all command-chat tests passed across 11
  files and 18 tests, Core typecheck passed, the full Core suite passed with
  331 files and 720 passed tests (3 skipped), and the Core evaluation passed
  with 5 files and 11 tests.
- The change stayed within the command-chat boundary. AX Studio, connector
  registration, uploads, live services, and the external manual-test fixture
  were not run or changed.

## Current task: deepen the runtime data plane for the realistic report path

Strengthen the existing modular-monolith seams so a realistic read-only
monthly-report request can preserve typed data contracts, source completeness,
explicit step outputs, and provenance through API/DB reads and deterministic
transforms. Keep the current product behavior compatible where possible and
make the first patch a vertical slice rather than a repository-wide rewrite.

### Success criteria

- Table-producing runtime capabilities return validated `TableArtifact` values
  with explicit completeness metadata; a row-limited result cannot be treated
  as a complete aggregate input.
- HTTP read responses have a validated structured contract that records bounded
  response metadata and can be converted to a table without heuristic shape
  guessing.
- Runtime action outputs are addressable through explicit `stepId.port`
  bindings while legacy step result compatibility remains intact.
- Existing RDB, HTTP, transform, workflow-binding, Core typecheck, and Core
  test suites remain green.
- The change is covered by focused tests at the new module interface and does
  not call live external connectors.

### Non-goals

- No microservices, event-sourcing system, or full runtime rewrite.
- No removal of row, byte, timeout, context, or execution safety limits.
- No automatic holdout gate or benchmark fixture/gold-answer modification.
- No PDF engine replacement, connected-folder export implementation, or UI
  redesign in this first vertical slice.

### Baseline (2026-09-04T15:00:54.1348673+09:00)

- Core tests: PASS, 331 files, 720 passed, 3 skipped.
- Core typecheck: PASS.
- Architecture check: PASS, 1,092 modules and 3,583 dependencies cruised.
- Existing runtime currently mixes connector outputs with `unknown` values and
  RDB `query.read` exposes raw rows despite declaring `TableArtifact` output.

### Final record (2026-09-04T15:48:34.2969772+09:00)

- Added shared completeness metadata and builders for table artifacts; RDB
  reads now probe one extra row and preserve `partial/row_limit` instead of
  presenting a bounded result as complete.
- Added a validated `HttpResponseArtifact`, explicit JSON row-path conversion
  to `TableArtifact`, and fail-closed aggregate evaluation for incomplete
  inputs.
- Added runtime output-port materialization and explicit `stepId.port` lookup
  for action bindings, conditions, and approval resume while retaining legacy
  `stepResults` compatibility.
- Focused data-contract tests passed 6 files/15 tests. Full Core regression
  passed 335 files/732 tests with 3 skipped; Core and Desktop typechecks,
  Desktop production build, evaluation (5 files/11 tests), architecture
  check (1,099 modules/3,622 dependencies), and whitespace checks passed.
- No live connector, credential, benchmark, PDF, external fixture, or UI
  execution was used or modified in this vertical slice.

## Current task: make generated PDF results recoverable and user-deliverable

When a PDF report is generated by a real execution, preserve its safe artifact
metadata in the workspace execution-result message and provide two explicit
host-owned delivery actions: Save As download and save to a user-selected
folder. Keep the internal artifact copy as the recovery source.

### Success criteria

- A valid `pdf_generated` execution log is projected into the mapped workspace
  chat without exposing stored paths, raw bytes, or credentials.
- Workspace and Activity result views expose both `다운로드` and
  `지정 폴더에 저장` for generated PDFs.
- Both actions validate the artifact source and never allow silent overwrite;
  cancellation and destination conflicts remain user-visible and recoverable.
- Folder selection is host-owned through a native dialog; agent input cannot
  supply an arbitrary filesystem destination.
- Existing export behavior, chat persistence, approval states, Core tests,
  Desktop typecheck, and Desktop build remain green.

### Non-goals

- No change to `D:\\ax_test`, benchmark fixtures, PDF generation engines, or
  external connectors.
- No connected-folder write capability or automatic background export.
- No redesign of the report pipeline or arbitrary path support in prompts.

### Final record (2026-09-04T16:39:15.1972084+09:00)

- Added a bounded generated-PDF contract to execution-result workspace chat
  messages. Only artifact ID, safe filename, size, and PDF MIME type cross into
  the renderer; host paths and raw bytes stay behind the IPC boundary.
- Added two explicit delivery actions to Workspace and Activity: `다운로드`
  opens Save As, and `지정 폴더에 저장` opens a native folder picker.
- Both host actions validate the stored artifact and use no-overwrite copy
  semantics. Cancellation and destination conflicts remain recoverable.
- Focused tests passed 29 tests; full Core regression passed 335 files/733
  tests with 3 skipped; Core evaluation 11/11; Core/Desktop typechecks,
  Desktop production build, architecture check (1,100 modules/3,626
  dependencies), and whitespace checks passed.
- No external fixture, benchmark, PDF engine, connector, credential, or
  connected-folder write capability was changed. A plain assistant reply with
  no execution result still has no generated file/card to deliver.

## Current task: recover command chat after a rejected provider response

When a provider returns a capability ID as the outer AX command, the host must
reject it without execution but recover internally by asking the provider once
for a valid AX command or a final reply. The user should not have to resend the
same natural-language request merely because the provider violated the wire
contract once.

### Success criteria

- Unsupported outer command names remain fail-closed and are never mapped or
  executed as capabilities.
- A single rejected provider response triggers one bounded, host-generated
  protocol correction; a subsequent valid reply or command continues normally.
- Repeated invalid provider responses stop after the bounded retry and return a
  safe user-facing message without parser details.
- Codex, Claude, and direct/API transport shapes share the same recovery
  behavior.
- Existing command chat, workflow, approval, execution, Core tests, Desktop
  typecheck, and Desktop build remain green.

### Non-goals

- No alias/legacy command mapping for capability IDs.
- No changes to connector permissions, database/PDF behavior, benchmark inputs,
  or external fixtures.
- No exposure of raw provider protocol errors, command contracts, credentials,
  or internal execution data to the user.

### Final record (2026-09-04T16:56:28.9220837+09:00)

- Confirmed the screenshot symptom with a red-capable exact-request test:
  `rdb.schema.describe` was rejected and the old loop immediately returned the
  resend message without a second model call.
- Added one bounded protocol-correction retry. It tells the provider that no
  command ran and that capability IDs belong inside `capability.invoke`, while
  leaving the original invalid command unexecuted.
- Persistent invalid output still terminates after the bounded retry with the
  existing sanitized message.
- Provider compatibility tests passed for Codex, Claude, and direct/API shapes;
  full Core regression passed 335 files/736 tests with 3 skipped; evaluation
  11/11; Core/Desktop typechecks, Desktop production build, architecture check
  (1,100 modules/3,626 dependencies), and whitespace checks passed.

## Current task: actual monthly-report discovery failure diagnosis

Diagnose the real AX Studio Dev session that rejected the Korean request to
recreate a September customer sales and operational-risk PDF from one completed
August report, one blank template, a connected order API, and customer/contract
database sources.

### Success criteria

- Reproduce the exact persisted `failed / no_matching_candidate` symptom with a
  fast, read-only command against the active Dev data store.
- Audit the actual session's source inventory, snapshots, observation paths,
  candidate/replay outcomes, and source-read budget without exposing secrets.
- Distinguish input/setup issues from parser, discovery, and workflow
  capability limits using code-backed evidence.
- Report the root cause and the smallest safe next direction without changing
  product behavior or external fixtures.

### Non-goals

- Do not patch Work Discovery, PDF generation, connectors, or UI in this task.
- Do not alter the failed session, connected services, credentials, uploaded
  documents, benchmark fixtures, or frozen evaluation results.

### Diagnostic record (2026-09-04T17:10:08.5503306+09:00)

- The exact persisted symptom reproduces from the active AXStudio-dev database:
  session `wd_4050af74de9d4477` is `failed` with
  `no_matching_candidate` and the required-output replay error.
- The run had one completed PDF example and one blank PDF template, both ready
  through Docling, so upload/ingest failure is ruled out.
- The source inventory contained 5,003 entries: three database tables and 5,000
  local-sheet files. No HTTP source was present, and all 12 source reads were
  consumed by the three database tables plus nine unrelated sheets.
- Document observation collapsed 43 distinct currency values onto the same
  `krw` path; none of 1,935 candidates for that path passed replay.
- Static inspection confirmed that HTTP has no Work Discovery provider, PDF
  input templates are not source materialized, ranking ignores the user goal,
  synthesis does not enumerate filters or joins, and the compiled workflow has
  no PDF output step.
- The fail-closed replay gate behaved correctly. The failure is a compound
  product-capability boundary plus source-selection/observation-model defects,
  not a malformed user request or unavailable REST/database service.

## Current task: teach-by-example PDF report generation

Implement a generic, bounded report-generation path for a user request that
combines one or more completed report examples, a blank PDF template, and
explicitly selected read-only HTTP/database sources into a verified generated
PDF artifact.

### Success criteria

- The report path has one cohesive public request/result seam; source capture,
  report-spec inference, computation, rendering, and verification remain
  independently testable behind it.
- Source selection is explicit and bounded. A requested HTTP connection and
  database tables are captured read-only, while unrelated connected-folder
  files and unselected connectors are never explored.
- HTTP capture materializes typed, complete snapshots (including bounded
  pagination) suitable for deterministic replay; database capture preserves
  provenance and completeness.
- Completed examples and blank templates have distinct roles. Structured report
  observations use stable, unique semantic locations instead of collapsing
  repeated labels or currency values onto one path.
- The report plan can express target periods, filters, joins/lookups, grouped
  rows, derived values, and explicit template field bindings without embedding
  fixture-specific labels, IDs, paths, dates, or expected values in production
  code.
- Rendering reuses the existing PDF form/fill engine, preserves the template as
  visual authority, verifies the produced PDF, stores it as an artifact, and
  exposes the existing download and user-selected-folder delivery actions.
- Unsupported or underdetermined requests fail closed with an actionable
  clarification/result; no database mutation, HTTP write, external delivery, or
  silent best-effort PDF is performed.
- The exact manual September-report request succeeds against the external test
  environment without exposing hidden gold data to discovery or production
  logic, and independent post-run validation records any residual mismatch.
- Focused tests, Core regression/evaluation/typecheck, Desktop typecheck/build,
  architecture checks, and whitespace checks pass.

### Non-goals

- Do not tune production behavior to `D:\\ax_test` filenames, schema names,
  report wording, dates, IDs, metric values, or hidden expected outputs.
- Do not modify frozen Work Discovery benchmark fixtures/gold/manifest or use
  hidden holdout/gold data as product input.
- Do not weaken the existing replay/publish safety gate for scalar Work
  Discovery, add arbitrary filesystem access, or broaden connector write
  permissions.
- Do not redesign unrelated Workspace UI or refactor unrelated dirty worktree
  changes.

### Implementation checkpoint (2026-09-04T18:50:10.7798937+09:00)

- Added a dedicated `report.generate` path instead of forcing this document
  workflow through broad scalar Work Discovery.
- The path compares a blank template with a completed example, selects only
  host-listed HTTP/RDB sources, probes HTTP response shape with GET only,
  captures complete period snapshots, infers a declarative plan, and refuses
  to render until the completed example replays exactly.
- The plan supports joins, filters, grouped/derived tables, runtime period and
  source metadata, computed/invariant/phase text, and metadata-rendered output
  filenames. Static prose must come from a bound example slot; numeric/date
  outputs must remain source- or metadata-derived.
- PDF geometry is inferred from each template's own rows, headers, neighboring
  tables, and page continuations. No report coordinates, table dimensions,
  source schema, dates, values, or prompt phrases from the external fixture are
  present in production code.
- Verification passed: report suite 32/32, Core 342 files/772 passed with 3
  skipped, evaluation 11/11, document engine 43/43, Core/Desktop typechecks,
  Desktop build, architecture, whitespace, and all 15 frozen benchmark hashes.
- Example replay may revise an invalid business plan at most twice using only
  bounded example-period mismatch/error evidence. Target-period rows remain
  unavailable until a plan reproduces the completed example exactly.
- The real AX Studio manual run and post-generation hidden-gold comparison are
  intentionally still pending for the user; hidden gold was not read during
  implementation.

## Current follow-up: Codex CLI image input

Forward ordered image bytes for text and structured generation, preserve owned
temporary-file cleanup on success/failure/cancellation, and retain safe image
error codes at the report boundary. No report-specific rules or gold changes.
Evaluator and baseline are recorded in codex-image-forwarding.md.

## Current follow-up: 업무 화면 분리

Make the existing 업무 navigation easier to scan by separating recurring
workflows from one-off execution results. Reuse existing workflow, execution,
and workspace-chat state; do not add new lifecycle behavior or change runtime
semantics.

Success criteria: recurring workflows appear in a labeled upper section with
active/paused and last-run cues; recent ephemeral executions appear in a
labeled lower section with readable status and a path to the existing result
conversation/activity view; empty and narrow states remain usable; existing
workflow toggles, deletion, chat loading, approval, and activity behavior stay
unchanged.
