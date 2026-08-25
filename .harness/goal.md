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
