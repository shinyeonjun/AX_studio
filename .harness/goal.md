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
