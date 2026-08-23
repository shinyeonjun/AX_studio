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
