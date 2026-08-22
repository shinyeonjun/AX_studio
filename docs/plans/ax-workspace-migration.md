# AX Workspace Migration

Status: **Authoritative for current implementation** (2026-08) — assistant-ui 기반 AX Workspace 제품 구조.

제품 **최종 목표**는 `docs/research/ax-north-star.md` / `docs/plans/ax-north-star.md`. 이 문서는 지금 코드가 하는 일(읽기 채팅 + `/once`·`/workflow` 설계)의 스냅샷이다.

이전 `docs/plans/ax-studio.md`는 v1 freeze / historical.

## 제품 정의

> ChatGPT/Claude처럼 대화하지만, n8n/Zapier workflow를 AI가 설계·실행해 주는 로컬 업무 자동화 앱.

| 모드 | 입력 | 동작 |
|------|------|------|
| 기본 채팅 | (슬래시 없음) | 연결 리소스 **읽기 전용** 조회·분석 |
| `/once` | `/once …` | workflow 설계 → 확인 → **즉시 실행** |
| `/workflow` | `/workflow …` | workflow 설계 → 확인 → **저장·트리거** |

## 아키텍처

```
assistant-ui (AxWorkspaceChat)
  → useInterview.sendMessage
  → parseWorkspaceCommand
      ├─ chat → ax:sendChat → runWorkspaceChat (core)
      └─ once|workflow → ax:startInterview / applyAnswer
  → WorkflowPreviewPanel (인터뷰 중에만)
```

## 유지 (삭제 금지)

- `packages/core/workflow/*`, `runtime/*`, `catalog/*`, `modules/*`
- interview compile / slots / Agent draft patch
- Gmail·Slack·PDF·folder connectors
- 승인·활동·설정 탭

## 제거됨

- `ChatPanel.tsx`, `WorkScopeSwitch.tsx`
- `poc/assistant-ui/*` (메인 앱으로 승격)
- PoC 해시 진입 (`#assistant-ui-poc`)

## 신규

- `packages/core/src/workspace/` — `parseWorkspaceCommand`, `runWorkspaceChat`
- `packages/core/src/agent/skills/workspace/SKILL.md`
- `packages/core/src/interview/agent/agent-loop.ts` — bounded read-only tool loop + typed draft patch
- `packages/core/src/interview/agent/agent-schema.ts` — native/CLI provider-safe output contract
- `packages/core/src/interview/agent/draft-patch.ts` — bounded draft-only patch contract
- `apps/desktop/src/components/workspace/AxWorkspaceChat.tsx`
- IPC `ax:sendChat`

## 완료 조건 (E2E)

1. 새 대화에서 일반 질문 → workflow 생성 없이 답변
2. `/once …` → 그래프 표시 → 검수 → 실행
3. `/workflow …` → 저장형 workflow
4. 기존 업무 열기 → 인터뷰 수정 흐름 유지
5. `npm test` (core) + `npm run build` (desktop) 통과

## 완료됨 (2차)

- `kind=discover`/`plan`/`replan` interview output 제거 — `tools`/`patch`/`reply`만
- assistant-ui 검수 카드 (`WorkspaceReviewCard`) + 실행 결과 카드
- Claude CLI `--max-turns` = role policy (interview/workspace 5턴)

## 완료됨 (5차)

- Interview를 Agent + typed read-only tools + draft-only patch loop로 전환했다.
- Agent tool 호출은 `tools.list`, 연결·소스·capability·현재 draft inspect를 통해 수행하며, 한 턴 최대 5개로 제한한다.
- `applyInterviewPatch`, `proposeRevision`, discovery/plan/replan 전용 schema·IPC·skill을 제거했다.
- `workflow.json` 저장은 명시적 review-card 동작으로만 수행한다. 연결된 workflow도 대화 중 자동 덮어쓰지 않는다.
- 클라우드 provider에는 PDF 본문을 설계/Workspace tool 결과로 보내지 않는다. 파일 메타데이터는 조회할 수 있고, 본문은 로컬 AI 정책에서만 bounded read가 허용된다.

## 완료됨 (3차)

- `design-tools/agent-loop.ts` — CLI/structured 출력용 공통 AX tool loop
- Anthropic API `tool_use` native loop (`workspace/anthropic-native.ts`) — workspace 채팅
- `ax:chat-progress` IPC — 채팅 진행 상태 UI 반영

## 완료됨 (4차)

- Lavender Lullaby 테마 + GPT/Claude 스타일 레이아웃 (좌측 탭·세션 / 메인 채팅)
- `workspace_chats` DB + 대화 세션 목록 IPC
- OpenAI / Grok API native function-calling loop
- CLI workspace loop `sessionId` — Cursor CLI resume 지원

## 남은 작업 (후속)

- Codex CLI multi-turn session resume (Cursor와 동일 패턴)

활동(실행 로그) 탭은 완료되었다. 좌측 `활동` 탭에서 수동 실행·트리거 실행·승인 대기·실패 기록과 현재 단계를 확인할 수 있으며, 런타임의 단계 진행 로그가 DB에 저장된다.

## 최종 E2E 마감 감사 (2026-08-23)

### 이번 마감에서 고정한 경계

- 대화는 설계·질문·읽기 전용 조회를 담당하고, 실행 여부는 명시적인 `/once` 또는 저장된 workflow 실행으로만 결정한다.
- AI는 `workflow.json`의 초안과 patch를 제안하지만, schema·catalog·binding·graph·approval 검수는 코드가 소유한다.
- 실행 결과의 진실 공급원은 `executions`와 단계 로그이며, 승인 대기는 실패가 아닌 `pending_approval` 영속 상태다.
- 외부 데이터는 bounded/untrusted 입력으로 처리하고, PDF·메일 본문을 클라우드 모델에 보낼 때는 `dataPolicy`를 독립적으로 검사한다.
- connected 상태가 아닌 로컬 폴더는 AI 컨텍스트와 source tool에 노출하지 않는다. 경로는 연결된 root 안으로 canonicalize한 뒤 읽는다.
- CLI는 긴 prompt를 argv에 넣지 않고 stdin으로 전달하며, argv와 stream 출력 모두 상한을 가진다. workflow/draft/tool-loop도 같은 상한을 공유한다.

### 코드·구조 정리 결과

- 런타임의 파라미터 해석·제어 흐름·포트 바인딩·action instance 변환을 별도 모듈로 분리했다.
- Electron IPC는 입력 경계와 chat/runtime/state/interview 책임을 분리했고, 대화 DB id와 provider resume id를 서로 다른 계약으로 유지한다.
- 실행 관찰을 전담하는 `ActivityPage`를 좌측 탭에 연결해 수동 실행·트리거·승인 대기·실패·단계 진행을 저장된 기록으로 확인할 수 있게 했다.
- 연결되지 않은 기존 코드와 이전 Work 화면/Sidebar/ApprovalPage 등 실제 import 경로가 없는 코드는 제거했다. `engine.ts`, `contract-validator.ts`, `bindings.ts`는 현재 한 책임 경계 안에서 cohesive하게 동작하고 있어 추가 분할은 이번 마감에서 보류했다.

### 최종 정적·회귀 QA

2026-08-23 00:13~00:16 KST 기준 다음 검사를 실행했고 모두 통과했다.

- Core: 70 test files, 343 tests
- Core eval: 11 tests
- Core TypeScript noEmit
- Desktop TypeScript noEmit
- Production build: core + desktop Electron renderer/main/preload
- Document engine: 17 tests, 2 optional `pypdf` tests skipped
- `git diff --check`

### 명시적으로 남은 검증 한계

- 실제 Gmail/Slack 계정과 연결된 외부 side-effect E2E는 이 환경에서 실행하지 않았다. 테스트는 mock connector와 runtime/approval 계약까지 검증한다.
- 보안 딥스캔은 Codex Security connector의 managed filesystem permission profile 오류로 실행되지 않았다. 대신 Electron bridge/context isolation, 환경변수 allow-list, credential 저장, local-folder root containment/symlink, untrusted input bounds, approval/global-off 경계를 수동 점검했다.
- Codex CLI provider session의 multi-turn resume은 후속 작업으로 남아 있다. 현재 workspace DB chat id를 provider session id로 오용하지 않는 경계까지만 보장한다.
- 설계/Workspace의 PDF source read는 `DesignToolContext.allowUntrustedData` 경계로 보호한다. 데스크톱은 cloud provider에서 본문 read를 차단하고 local provider에서만 bounded read를 허용한다. 실행 중 PDF·메일 본문은 별도로 workflow `dataPolicy`를 검사한다.

이 문서는 현재 제품의 마감 기준과 남은 운영 리스크를 함께 기록한 authoritative 문서다. 이후 기능 추가는 이 경계를 깨지 않는 작은 실험과 동일 evaluator를 통해 진행한다.
