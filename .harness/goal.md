# Goal: Agent-native workflow control plane

Status: ACTIVE

## User Request

현재 구현된 인터뷰/workspace 분리를 AI 전용 `ax` CLI와 공통 Workflow Command Service 중심으로
재구성한다. 사용자는 자연어 대화만 사용하고, GPT CLI·Claude CLI·Ali·Ollama는 허용된 `ax` 명령으로
workflow를 조회·생성·수정·검증·저장·실행한다.

## Desired Outcome

- AI가 거대한 workflow JSON을 매 턴 출력하거나 사용자에게 노출하지 않는다.
- 대화 세션은 하나의 일관된 transcript/context로 동작하고 `/once`, `/workflow`는 저장 형식이 아닌 실행 모드다.
- AI 전용 CLI는 일반 shell 명령을 실행하지 않고 AX 도메인 명령만 허용한다.
- CLI, Electron IPC, UI는 하나의 `WorkflowCommandService`를 사용한다.
- 누락값은 코드가 질문 문장을 하드코딩하지 않고 field/path/type/reason 계약으로 반환하며 AI가 자연어로 질문한다.
- workflow JSON/IR은 내부 canonical 저장·Runtime 입력으로만 사용한다.
- create/read/update/delete/validate/diff/run/approval 흐름이 세션과 revision을 보존하며 이어진다.

## Success Criteria

- [x] agent-only `ax` command contract와 allowlist가 schema/test로 고정된다.
- [x] CLI·IPC·대화 agent가 같은 command service를 호출하고 기본 workspace 경로에 중복 실행 루프가 없다.
- [x] workflow CRUD와 missing-input conversation loop가 JSON transcript 노출 없이 동작한다.
- [x] `/once`와 `/workflow`가 동일 workflow 모델의 실행 모드로 처리된다. UI는 command chat으로만 라우팅되고 구형 검토 카드/직접 실행 IPC는 제거됐다.
- [x] 잘못된 command, revision 충돌, 누락값, 승인 필요, Runtime 실패가 명시적 상태로 반환된다.
- [x] 기존 Gmail/Slack/PDF/Runtime 테스트와 frozen evaluator가 유지되거나 변경 이유가 기록된다.
- [x] 기존 인터뷰 쓰기 구조의 제거 범위가 정리됐다. 구형 workspace native chat과 interview 시작/답변/직접 저장/run IPC는 제거했고, 기존 interview 기록은 읽기 전용 호환 경로로 남겼다.

## Constraints

- 현재 dirty worktree의 기존 사용자 변경을 되돌리거나 삭제하지 않는다.
- 일반 `cmd.exe`, PowerShell, 임의 파일/네트워크 명령을 AI 실행 표면으로 허용하지 않는다.
- workflow canonical schema, catalog, approval, Runtime 정책을 우회하지 않는다.
- 질문 문장과 특정 Gmail/Slack/PDF 사례를 코드에 하드코딩하지 않는다.
- CLI는 새 실행 엔진이 아니라 기존 Store/Validator/Runtime을 호출하는 adapter/service로 만든다.
- 실제 외부 Gmail/Slack side effect는 승인·mock·sandbox 경계 밖에서 실행하지 않는다.

## Non-goals

- 새로운 외부 connector 추가.
- 자연어용 암호 문법(`tgr.a.ss`) 개발.
- workflow JSON/IR 자체 제거.
- provider별 workflow 구현 복제.
- unrelated UI redesign, dependency upgrade, OCR 품질 변경.

## Policy Extension: cloud document analysis

The workflow/document path must allow Claude, Codex, Ollama, and other configured
providers to analyze Docling output by default. A workflow may still opt out by
explicitly setting the relevant `dataPolicy.*.cloudAllowed` value to `false`.

Success criteria for this extension:

- [x] Desktop and CLI source reads do not infer a provider-specific PDF block.
- [x] Runtime PDF/email analysis treats an absent policy as allowed and an explicit `false` as denied.
- [x] Docling remains the preprocessing engine; the change only controls whether extracted evidence may enter the selected AI provider.
- [x] Existing explicit-deny privacy tests continue to pass.

## Current Baseline

- Recorded: 2026-08-23T09:47:51.4092074+09:00
- Current worktree: pre-existing dirty changes from the previous repository audit are preserved.
- Core tests: 87 files / 409 tests passed.
- Core eval: 11/11 passed.
- Core and desktop TypeScript checks: passed.
- Document engine: 17 tests, 15 passed, 2 skipped because `pypdf` is unavailable.
- Production build: passed.
- Native DB note: the installed `better-sqlite3` binary targets Node ABI 132 while the current Node
  process requires ABI 137; tests therefore exercised the documented sql.js fallback.
- The previous evaluator baseline and its audit goal remain historical evidence; this is a new,
  non-comparable architecture goal.

## Current Checkpoint: agent-command-source-cli

- Agent-facing `ax` CLI adapter is available through `npm run ax -- <command> [args-json]` or
  `--json`; it calls the same `AxCommandService` as Electron IPC and closes the database after the
  bounded operation.
- New workspace conversations never call the legacy interview start/apply/save/run APIs. Existing
  interview sessions remain readable and are routed into the command chat when continued.
- The command chat graph is rendered from the canonical stored workflow association on the workspace
  chat; protocol JSON and review-card controls are not part of the user-facing path.
- `AX_DEBUG_DB=1` is required for verbose database fallback diagnostics; normal command/UI output is
  not polluted by the known better-sqlite3 ABI mismatch.
- Checkpoint verification: core 86 files / 408 tests, core and desktop typechecks, eval 11/11,
  document-engine 17/17, full build, CLI smoke, and `git diff --check` passed.

## Current Checkpoint: provider-neutral-document-policy

- Desktop and CLI command contexts allow bounded document evidence by default; explicit callers can
  still set `allowUntrustedData: false`.
- Runtime document/email evidence is cloud-allowed when the policy is absent or true; explicit false
  remains fail-closed.
- Agent instructions describe `source.file.read`/`document.ingest` as host operations whose default
  local document engine is Docling. The model does not receive a direct Docling execution surface.
- Verification: targeted 33/33 tests, full core 409/409, core/desktop typechecks, production build,
  and `git diff --check` passed. The existing Vite db import warning and intentional test stderr remain.

## Current Task: session-scoped execution mode and workflow association

The active workspace conversation is the source of truth for the user's ongoing context. A `/once`
command promotes that conversation to once-mode; later messages inherit the mode without requiring
the command again. The workspace chat stores its execution mode and canonical `workflowId`, and
opening a workflow restores the latest mapped workspace conversation when one exists.

Success criteria:

- [x] `once`/`workflow` execution mode is persisted with workspace chat records and survives restart.
- [x] `/once instruction` sends only the instruction to the agent while the session retains once-mode.
- [x] Follow-up messages use the mapped workflow and inherited mode automatically.
- [x] A workflow opened from the UI restores its mapped workspace chat instead of creating a detached context.
- [x] Existing workspace chat rows migrate without data loss; legacy interview rows remain readable.
- [x] Store, command-chat, desktop IPC/preload, UI hook, typecheck, tests, and production build remain valid.

Constraints:

- Do not reintroduce the legacy interview write path or hard-coded workflow-specific questions.
- Do not expose protocol JSON to the user-facing transcript.
- Keep the existing canonical workflow JSON/IR and command service as the execution boundary.
- Preserve pre-existing dirty changes and avoid real connector side effects.

## Current Task: command authorization boundary — phase 1

The first architecture patch makes the command gateway enforce the conversation mode that the
UI already records. `plain_chat`, `/once`, and `/workflow` must reach the host-side command
service with an explicit interaction context; the model prompt is not an authorization boundary.

Success criteria:

- [ ] Plain chat cannot create, update, or delete workflows through `AxCommandService`.
- [ ] Plain chat may only inspect resources and run an existing stored workflow through the
  explicitly supported saved-workflow path.
- [ ] `/once` may author a one-time workflow and run that one-time flow; `/workflow` may author
  and save but may not run during the authoring loop.
- [ ] The Electron command-chat path passes the actual interaction mode into both command
  execution and the desktop design-tool context.
- [ ] Direct unscoped command execution defaults to the restrictive plain-chat policy.
- [ ] Regression tests prove forbidden commands do not mutate the store or invoke the runner.

Non-goals for this phase:

- Unifying scheduler, trigger, manual-run, and command execution behind a new service.
- Changing Docling, connector implementations, database persistence, or provider session resume.
- Removing legacy interview persistence or changing the user-facing workflow UI.

## Current Task: remove legacy interview control plane

The command protocol is now the only supported workflow authoring and workspace interaction
path. Remove the obsolete interview/skill/IPC compatibility implementation instead of keeping
it as an alternate write path. Preserve only workflow schema, compilation, validation, storage,
and UI types that are still used by the command-first path.

Success criteria:

- [x] New workspace chat and `/once`/`/workflow` paths have no dependency on legacy interview
  start/apply/save/run APIs.
- [x] Legacy interview agent loop, session flow, legacy write IPC, and legacy-only skills are
  removed or replaced by the command protocol.
- [x] `AGENTS.md` and role instructions describe the AX command boundary as the single agent
  interface; no stale workflow/skill instructions remain in the active command prompt.
- [x] Legacy interview storage is no longer an active write path. Existing data handling is
  retained only if required for an explicit migration/read-only compatibility contract.
- [x] No dead imports, generated skill entries, stale tests, or package exports reference removed
  legacy code.
- [x] Frozen evaluator checks pass, with any intentional baseline change recorded explicitly.

Constraints:

- Preserve the canonical Workflow IR/schema, catalog, Runtime, approval, command service, and
  workflow graph data required by the current product.
- Do not delete user data or run destructive database migrations in this phase.
- Preserve unrelated dirty-worktree changes; only remove code proven to be legacy or made dead by
  this removal.

This task supersedes the earlier command-authorization phase where plain chat was described as
being able to run a saved workflow. The current boundary is stricter: plain chat is read-only,
authoring owns workflow CRUD, and only an explicit once-mode execution context may run a workflow.

## Current Checkpoint: legacy-control-plane-removal-2026-08-23

- Removed the interview Agent loop, session/slot patch flow, legacy write IPC, old native workspace
  chat path, duplicate design-tool workflow list/inspect/run tools, and empty legacy skill files.
- Preserved the active workflow compiler/schema, catalog, Runtime, approval, document/Docling path,
  connector skills used by Runtime investigation, and the graph/canvas view required by the UI.
- Command authorization is enforced in code: plain chat is read-only; authoring can CRUD but not
  run; once-mode can run after the host grants that execution context.
- Verification: core 72 files / 328 tests, core and desktop typechecks, eval 11/11,
  document-engine 17/17, production build, and `git diff --check` passed.
- The `packages/core/src/interview` directory is retained only as the currently-used workflow
  draft/compiler and canvas compatibility namespace; it contains no interview session or Agent
  control plane. Renaming that namespace is a separate mechanical migration, not a legacy write
  path.

## Current Checkpoint: command-read-gateway-2026-08-23

- `AxCommandService` no longer imports or dispatches through the design-tool registry directly.
  Source/capability reads go through the narrow `AxCommandReadGateway` adapter.
- The default adapter still uses the existing guarded design-tool handlers, but creates their
  context lazily only when a read command is selected. Workflow-only commands cannot enter that
  read path.
- A regression test proves `workflow.list` makes zero read-gateway calls while `source.list`
  makes exactly one.
- Verification: command tests 14/14 and core typecheck passed.

## Current Checkpoint: command-boundaries-2026-08-23

- `AxCommandService` now delegates workflow listing, inspection, validation, CRUD, version
  conflict handling, step normalization, and run dispatch to `workflow-gateway`.
- Workspace chat registration is split into command execution, persistence, and workflow view
  projection handlers; the command handler creates its design-tool read context lazily.
- Workflow-only commands do not enter the source read gateway or build a design-tool context.
- Verification: core tests 71 files / 327 tests, core eval 11/11, core and desktop typechecks,
  production build, document-engine 17/17, and `git diff --check` passed. The root-level
  document-engine command was first run from the wrong directory and was rerun from its package
  directory successfully.

## Current Checkpoint: command-dispatch-laziness-2026-08-23

- The CLI passes a lazy read-context factory instead of constructing connector instances before
  every command. Runtime idle waiting is now limited to the explicit `workflow.run` command.
- Command-chat guidance requests resource/capability/workflow reads only when an identifier,
  contract, or current version is actually missing; known values are not re-discovered by rule.
- CLI smoke `workflow.list` returned successfully without a read command; document-engine and
  full regression checks remain green.

## Current Checkpoint: command-surface-isolation-2026-08-23

- `runAxCommandChat` and the fallback command role prompt no longer import or enumerate the
  legacy design-tools prompt surface. Design-tools remain behind the read gateway and are reached
  only when a source/capability read command is selected.
- The command prompt now distinguishes required discovery from redundant rediscovery.
- Verification: targeted command/context tests 16/16, full core 71 files / 327 tests, eval 11/11,
  core/desktop typechecks, production build, document-engine 17/17, CLI workflow.list smoke, and
  `git diff --check` passed. The document-engine check was rerun from its package directory after
  the expected root-directory path miss.

## Current Checkpoint: workflow-canvas-ownership-2026-08-23

- Canonical canvas draft schema, action helpers, slot ids, branch hints, parameter filling, and
  completeness evaluation now live under `workflow/canvas/*`.
- `workflow/workflow-view` and `workflow/visual-display` no longer import `interview/*`.
- The old `interview/draft` and `interview/slots` paths are compatibility re-exports only, so
  existing callers can migrate without maintaining duplicate logic.
- Verification: targeted canvas/interview compatibility tests 21/21, full core 71 files / 327
  tests, eval 11/11, core/desktop typechecks, production build, document-engine 17/17, and
  `git diff --check` passed. The document-engine check was rerun from its package directory after
  the root command's expected relative-path miss.

## Previous Checkpoint: minimal-agent-skills-2026-08-23

- The agent skill surface now contains only `command` for AX command authoring and `investigate`
  for the Runtime's bounded read/judgement step.
- Connector-specific prompt skills and their routing/loader exports were removed. Connector
  behavior remains defined by catalog capability contracts and Runtime code, so removing those
  prompt copies does not remove Gmail, Slack, PDF, or local-folder functionality.
- Embedded production skill data contains exactly the two active skills.
- Verification: core 71 files / 326 tests, core and desktop typechecks, eval 11/11,
  document-engine 17/17, and production build passed. The skill validator was not runnable
  because the host Python environment lacks the optional `yaml` module; frontmatter and embedded
  output were checked directly.

## Current Checkpoint: runtime-investigation-boundary-2026-08-23

- Runtime no longer depends on the concrete `AgentHarness`; its AI decision path accepts only
  the narrow `InvestigationRunner` protocol needed for provider identity and structured output.
- The Agent layer owns the adapter that binds the general harness to that protocol. Runtime keeps
  responsibility for evidence collection, data-policy checks, bounded reads, and result persistence,
  while model policy, prompts, timeout, and provider selection remain in the Agent Harness.
- `RuntimeConfig` and the live refresh path now use `investigationRunner`, so changing the command
  agent surface cannot accidentally expose the full harness to workflow execution.
- Verification: targeted runtime tests 34/34, full core 71 files / 327 tests, core eval 11/11,
  core and desktop typechecks, production build, document-engine 17/17, and `git diff --check`
  passed. Existing Vite import warning and intentional test stderr remain non-blocking.

## Current Checkpoint: provider-command-transport-2026-08-23

- Codex CLI, Claude CLI, and direct API/local providers now have independent command-chat wire
  adapters. Codex receives a flat strict object (`commandName` + JSON-encoded `argsJson`) because
  its `--output-schema` contract cannot safely express the canonical union; Claude receives a
  nested command object through its own JSON schema; API/local providers retain the canonical
  `{kind, command, message}` shape.
- `runAxCommandChat` only selects and normalizes the provider transport. Command execution and
  the canonical AX command service remain provider-neutral, so changing the selected provider
  cannot duplicate workflow or Runtime behavior.
- The old shared provider-envelope module was removed after its production references were
  eliminated. A regression suite covers all three transport families and rejects malformed
  provider output instead of interpreting a bare command string as an executable command.
- Verification: core 72 test files / 328 tests, core eval 11/11, core and desktop typechecks,
  core build, document-engine 17/17, and `git diff --check` passed. Existing ABI fallback,
  Vite import warning, and intentional test stderr remain non-blocking.

## Current Task: workspace chat session transition isolation

When a user starts a new workspace conversation while a previous command-chat request is still
finishing, the old request must not keep the new conversation busy or deliver stale progress.
Each active renderer request owns a unique request id, and changing/loading a session cancels the
previous request before the new conversation can send a message.

Success criteria:

- [x] Starting, loading, or opening a chat cancels the prior active command-chat request.
- [x] Progress events from an old request cannot appear in the new chat.
- [x] A second send is rejected only while the current request is active; it is available again
  after success, error, cancellation, or session transition.
- [x] The renderer passes a stable request id to the main-process cancellation registry.
- [x] Desktop typecheck and the frozen core/evaluator/build checks remain green.

## Current Checkpoint: workspace-chat-session-transition-2026-08-24

- The renderer now creates one unique request id per command-chat send and passes it through the
  preload IPC boundary. New chat, chat loading, and workflow opening cancel the active request
  before invalidating the old session epoch.
- Progress events are accepted only for the active request, preventing an old provider response
  from changing the new chat's progress state. A ref-backed busy guard prevents fast duplicate
  sends even before React has committed the state update.
- Verification: desktop typecheck, core 72 files / 328 tests, core eval 11/11, full production
  build, document-engine 17/17, and `git diff --check` passed.

## Current Task: secure Slack Socket Mode configuration boundary

Slack Bot and App-Level tokens are stored in the desktop OS credential store, while the core
trigger driver currently reads only the persisted connection metadata. The connection UI can
therefore show `appTokenStored` while Socket Mode receives no actual App Token and silently falls
back to poll/partial status. Pass the hydrated secret only through the in-memory trigger refresh
boundary; never copy token values back into the database.

Success criteria:

- [x] Hydrated Slack App Token reaches the Socket Mode driver at startup and after reconnect.
- [x] The database continues storing only token-presence metadata, not raw Slack tokens.
- [x] Socket Mode and manual Slack sending remain independently diagnosable.
- [x] A Bot Token `missing_scope` response is preserved as a permission error, not misreported as
  a token-storage failure.
- [x] Core tests, desktop typecheck, production build, and whitespace checks pass.

Non-goals:

- Do not weaken Slack scope enforcement or fabricate channel IDs.
- Do not store credentials in workflow JSON, SQLite connection metadata, or chat history.

Non-goals:

- Do not change command authorization, provider wire formats, workflow persistence, or Runtime.
- Do not allow concurrent command requests in one workspace conversation.

## Current Task: Slack Socket Mode heartbeat tolerance

The Slack Socket Mode SDK uses a 5-second client pong timeout by default. In a desktop app,
short OS scheduling, proxy, or network delays can produce a false heartbeat warning and trigger
an unnecessary reconnect even though the connection is otherwise healthy.

Success criteria:

- [x] The Slack listener uses an explicit heartbeat tolerance appropriate for the desktop runtime.
- [x] Heartbeat monitoring and automatic reconnect remain enabled.
- [x] Core tests, desktop typecheck, production build, document-engine tests, and whitespace checks pass.

Non-goals:

- Do not disable ping/pong health checks or hide genuine disconnects.
- Do not change Slack token scopes, channel resolution, or workflow behavior.

## Current Checkpoint: slack-socket-observability-2026-08-24

- Slack Socket Mode now reports lifecycle state through the push-transport boundary instead of
  treating the client object as proof of an active WebSocket.
- The listener checks the SDK's underlying `websocket.isActive()` result, preserves the SDK's
  original/cause error, and forwards connecting, reconnecting, connected, and disconnected state.
- Desktop state now distinguishes a live socket from reconnecting/error states and refreshes when
  the transport lifecycle changes.
- Verification: core 73 files / 330 tests, eval 11/11, core and desktop typechecks, production
  build, document-engine 17 tests (2 skipped because pypdf is unavailable), and `git diff --check`
  passed.

## Current Task: conversational workflow registration and input UI

Replace the user-facing `/once` and `/workflow` entry points with natural-language workspace
chat plus explicit UI controls. The agent command loop remains the internal workflow interface;
when a command or workflow contract needs a value, the host returns a typed input request that
the conversation UI renders as an inline input card. A completed workflow is registered through
an explicit button instead of an implicit command-mode prefix.

Success criteria:

- [ ] New workspace chats no longer expose or parse slash commands.
- [ ] Authoring mode is selected through UI state, while ordinary chat remains read-only.
- [ ] Missing workflow values produce a typed `input_request` result for the renderer without
  exposing protocol JSON in the transcript.
- [ ] The user can submit an input card value through the same conversation and continue the
  command loop.
- [ ] A completed workflow has an explicit `워크플로우 등록` action that activates it through the
  existing Runtime/store boundary.
- [ ] Existing persisted chats and workflows remain readable; no destructive migration occurs.
- [ ] Core tests, desktop typecheck, production build, and whitespace checks remain green.

Non-goals for this task:

- Replacing the canonical workflow IR or Runtime.
- Implementing a new provider transport or connector.
- Persisting UI-only input cards as a second transcript format.
- Allowing ordinary chat to mutate or execute workflows.

## Current Task: ephemeral one-shot command execution

Make one-shot requests execute as host-validated ephemeral runtime jobs instead of creating
saved workflows. Persistent workflows remain the only saved automation artifact.

Success criteria:

- [ ] `execution.enqueue_once` is available only in one-shot authoring mode.
- [ ] The command validates the same catalog/action and contract rules as workflow creation.
- [ ] Enqueued jobs execute serially through Runtime with `ephemeral: true` and do not create a
  workflow row.
- [ ] Persistent workflow creation continues to use `workflow.create` and the existing
  registration/activation boundary.
- [ ] The desktop receives an immediate queued result while execution/approval logs remain
  authoritative.
- [ ] Core tests, typechecks, production build, and regression checks remain green.

Non-goals for this task:

- No new connector-specific direct-send commands.
- No change to the persistent workflow JSON schema.
- No removal of execution history or approval records.

## Current Task: conditional rich assistant presentation

Keep ordinary command-chat replies as ordinary assistant text. When the agent needs
structured user interaction—such as reviewing evidence, choosing a route, approving a
plan, or entering a missing value—it may issue a bounded read-only `ui.present` command.
The host must keep that command envelope out of the transcript and attach the validated
presentation to the assistant message so the renderer can show a card, buttons, or inputs.
Controls submit normal user text back through the same conversation; they must not invoke
connector side effects directly.

- [x] `ui.present` is available as a non-mutating AX command in ordinary chat and authoring
  contexts, with bounded schema validation.
- [x] The command loop keeps the presentation JSON internal and still returns a normal
  natural-language assistant reply.
- [x] The Electron IPC and persisted workspace-chat message contract can carry optional
  validated presentations and input requests without breaking old chats.
- [x] The renderer shows cards/buttons/inputs only when the assistant message contains a
  presentation; ordinary assistant replies remain plain markdown.
- [x] A card action or input is sent as a user message through the existing chat path and
  does not directly execute a connector command.
- [x] The former slash parser, slash mode-picker UI, and package alias are removed while
  the runtime execution-mode type and queue remain available.
- [x] Core tests, typechecks, production build, and whitespace checks remain green.

Non-goals for this task:

- No arbitrary HTML, React, shell, connector API, or command execution in presentation data.
- No replacement of the canonical workflow IR, Runtime, provider transports, or persistence
  database schema.
- No global input-card renderer that appears independently of its assistant message.

Checkpoint (2026-08-24): `ui.present` is implemented and legacy slash-entry plumbing is
removed. The final evaluator passed: core 73 files/334 tests, core eval 11/11, document-engine
17 tests with 2 pypdf skips, core/desktop typecheck, production build, and `git diff --check`.

## Current Task: agent-native lifecycle and provider boundary

Make workspace chat agent-native: the user sends natural language only, the agent chooses
reply/read/ephemeral execution/persistent workflow commands, and the host validates and runs
those commands. Remove the obsolete user-facing execution-mode state instead of retaining it as
an implicit compatibility path. Keep provider-specific Codex and Claude behavior behind a common
host boundary and preserve typed UI requests as out-of-band conversation events.

Success criteria:

- [ ] `WorkspaceExecutionMode` is absent from workspace chat, presentation actions, IPC, and chat persistence.
- [ ] Command definitions expose a lifecycle (`read`, `present`, `ephemeral`, `workflow`, or `run`)
  and the agent prompt uses command lifecycle rather than a user-selected mode.
- [ ] `workflow.create/update/delete`, `execution.enqueue_once`, and `workflow.run` are reachable
  from the natural-language agent command path without mode-specific gating.
- [ ] Existing workflow trigger semantics and Runtime execution/approval boundaries remain intact.
- [ ] Codex and Claude command transports remain provider-specific but conform to the same command
  result contract.
- [ ] Existing chats and workflows remain readable; obsolete execution-mode values are ignored,
  not reintroduced into the new API or transcript.
- [ ] Core tests, typechecks, production build, eval, and whitespace checks pass.

Non-goals for this task:

- No direct connector calls from the renderer or provider process.
- No removal of real workflow trigger types or Runtime execution receipts.
- No broad connector feature additions unrelated to the agent boundary.

Baseline checkpoint (2026-08-24T04:31:30.4070744+09:00): current dirty worktree passed core
tests (73 files/334 tests), core typecheck, desktop typecheck, and `git diff --check` before
this task's implementation. The production build is rerun at the end of the first patch.

## Queued Product Direction: teach by example

The next product capability is not another natural-language workflow builder. After the
agent-native command boundary is complete, AX should learn a bounded recurring document/report
workflow from real input/output examples supplied by the user.

The unit of learning is an example bundle, not a prompt:

- input artifacts: files, document evidence, database extracts, or relevant messages;
- expected output artifact: the report/message/document a person accepted as correct;
- hypothesis: an inspectable input → transformation → output mapping proposed by the agent;
- replay: deterministic re-execution against prior examples;
- drift: a difference in output structure, required fields, values, or source shape even when
  Runtime reports success;
- repair proposal: a candidate mapping change that must pass replay checks before activation.

The first bounded slice targets recurring reports and document workflows. It reuses the existing
catalog, Workflow IR, Docling evidence path, Runtime, approval boundary, and command chat. The
agent may propose hypotheses and ask only unresolved questions; code performs replay, comparison,
revision, and activation. A successful run is not treated as a correct business result without a
regression check.

This is queued behind the current lifecycle work. It must get its own goal/evaluator baseline
before production code is added; the current agent-native evaluator remains unchanged.
