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

### Verification checkpoint (2026-09-02T09:15:00.3194676+09:00)

- The release audit passed across the current safe product surface: Core 130
  files/705 tests passed with 3 skips, integration 72/72, connector seam 2/2,
  deterministic Product QA full 61/61 and smoke 19/19, with zero defects.
- The first GitHub Actions run exposed a release-packaging omission: two new
  Product QA scenario fixtures were present locally but ignored by the
  repository's broad `test/` rule. The candidate remains pending until those
  fixtures are included and CI is green.
- Core evaluation passed 11/11, desktop TypeScript checking and the production
  build passed, dependency architecture reported zero violations across 513
  modules and 1,823 dependencies, and Knip reported no issues.
- The Windows NSIS installer and unpacked build were generated successfully;
  the packaged app launched with isolated data and rendered its first screen.
  The installer is `AX Studio Setup 0.1.0.exe` (106,127,243 bytes) and the
  unpacked executable is `AX Studio.exe` (190,557,184 bytes).
- No product-code failure was found; the required follow-up is limited to
  including the missing test fixtures. The candidate remains without Figma
  changes, external side effects, secret exposure, destructive cleanup, or
  public upload.
- Known limits remain explicit: live AI/account paths and real Gmail/Slack/HTTP
  delivery or remote/database mutation were not run; eight side-effect
  scenarios remain intentionally excluded from the deterministic coverage
  denominator. The demo installer is unsigned and uses Electron's default icon.
