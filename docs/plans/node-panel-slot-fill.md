# Node Panel Slot Fill Implementation Plan

Status: Superseded — **do not implement the instructions in this file.** See `packages/core/src/interview/README.md`, `packages/core/src/interview/agent/agent-loop.ts`, and `packages/core/src/agent/skills/interview/SKILL.md` for the shipped architecture.

This document describes an earlier panel-first design. The shipped model uses **work scope + chat interview** for trigger and action params; the node detail panel is read-only.
It is retained only as migration history; its `applyInterviewPatch`, `discover`, `plan`, and `replan` references are intentionally obsolete.

Scale: Medium

## Goal

인터뷰에서 빈 필수 값을 채팅 번호 목록으로 묻지 않는다. AI는 그래프를 그리고 이미 아는 값만 채운다. 남은 채널·수신자·시작 조건은 오른쪽 **노드 패널**에서 바로 입력한다. 코드가 빈 칸과 배포 가능 여부를 계산한다.

사용자는 노드를 그리지 않는다. AI가 그린 노드의 빈 칸만 채운다.

## Current Facts

- 인터뷰 흐름은 `discover → plan/replan → patch → compile → assessCompleteness`다. (`packages/core/src/interview/README.md`)
- 그래프는 `InterviewDraft`만 렌더한다. 노드 클릭 시 `NodeDetailPanel`이 **읽기 전용**이고, 수정은 채팅 힌트(`beginEditStep`)로 넘긴다.
- 빈 슬롯은 `assessCompleteness` + 카탈로그 `required` params로 계산한다. 그래프 노드는 `incomplete` 표시가 있다.
- 채팅은 `formatBatchedInterviewQuestions`로 `1. 2. 3.` 목록을 만들고, 답은 모델 `patch` 또는 번호/「지금」 코드 파싱에 의존한다. 이 경로가 루프의 원인이다.
- 패널 저장용 LLM-less IPC는 없다. 값 변경은 전부 `ax:applyAnswer` → 인터뷰 에이전트다.
- 연결(Gmail/Slack/폴더)은 설정 화면에 있다. 채팅 속 credential 카드는 없다.

조사 근거: [인터뷰 값 수집 패턴](../../../../Users/plosind/.cursor/projects/d-AX-studio/canvases/interview-collection-patterns.canvas.tsx) — Zapier는 나머지를 에디터에, n8n/Make는 연결을 카드에, 값은 노드에 둔다.

## Proposed Behavior

1. 사용자가 일을 말하면 AI가 그래프를 그린다. 연결된 폴더·계정·지시문에 있는 값은 plan/patch로 채운다.
2. 채팅은 이해한 일을 **짧게** 확인하고, 빈 칸이 있으면 “오른쪽에서 비어 있는 노드를 채워 주세요”만 안내한다. `1. 2. 3.` 질문 목록을 출력하지 않는다.
3. 빈 required 슬롯이 있는 노드는 지금처럼 incomplete로 표시한다. **첫 빈 노드를 자동 선택**해 패널을 연다.
4. 노드 패널은 해당 노드의 필드를 편집한다.
   - action: 카탈로그 required(+ 이미 있는 optional) 문자열 필드. 예: Slack `channel`, Gmail `to`.
   - trigger: 시작 방식(지금 한 번 / 예약 / 새 메일 / 새 슬랙 / 폴더 새 파일)과 그에 딸린 값.
   - ai_decision: 목적(읽기) + `memo` 텍스트.
   - if / 승인: 이번 범위에서 구조 편집 없음. 읽기 + “이 흐름 바꾸기”만.
5. 패널 저장은 **에이전트를 호출하지 않는다.** `applyInterviewPatch`가 `actions`/trigger에 값을 넣고 completeness를 다시 계산한다.
6. 채팅으로 “채널을 #ops로 바꿔”처럼 말하면 기존처럼 `applyAnswer` → AI patch. 구조 변경은 `replan`.
7. 연결이 없으면 패널/채팅에 설정으로 가는 안내만 한다. credential 채팅 카드는 이 계획에 넣지 않는다.
8. 모든 필수 칸이 채워지면 지금과 같이 검토·저장·실행 UI가 뜬다.

## Success Criteria

- PDF 분류 + critical/high Slack/메일 시나리오에서, 그래프가 뜬 뒤 채팅에 번호 질문이 나오지 않는다.
- Slack 채널·메일 주소를 노드 패널에 넣으면 에이전트 호출 없이 슬롯이 채워지고 incomplete가 사라진다.
- 「지금 한 번」은 trigger 노드 패널에서 고를 수 있고, 그 경우 `triggerType=manual`이 된다.
- 채팅으로 채널을 바꿔 달라고 하면 기존처럼 반영된다.
- 관련 테스트·타입 검사가 통과한다.

## Non-Goals

- 사용자가 캔버스에 노드를 추가/삭제/드래그로 연결하는 에디터.
- if 조건 빌더, 바인딩 시각 편집.
- Slack 채널 목록 피커, Gmail 주소록 피커. (v1은 텍스트 입력)
- 채팅 속 OAuth/credential 카드.
- 번호 답변 파서를 더 키우는 일. 메인 경로에서 제거한다.

## Architecture

```text
사용자 지시
  → AI plan/patch          # 그래프 + 아는 값만
  → code assessCompleteness
  → UI 그래프 + 노드 패널  # 남은 required
  → applyInterviewPatch    # LLM 없음
  → 다시 completeness
```

역할:

| 층 | 소유 | 하지 않는 것 |
|---|---|---|
| AI | plan/replan, 채팅 수정 patch, 아는 값 채우기 | 필수 칸을 채팅으로 전부 묻기 |
| 코드 | completeness, compile, `applyInterviewPatch` | 한국어 문장 정규식 NLU |
| UI | 노드 패널 필드, 첫 빈 노드 자동 선택 | 채팅에 가짜 폼(번호 목록) |

### 새 코어 API

`packages/core/src/interview/session/patch-turn.ts` (이름은 기존 `slots/patch.ts`와 겹치지 않게):

```ts
applyInterviewPatch(state: InterviewState, patch: InterviewPatch): InterviewState
```

- `mergePatch` + `applySlotValuesToDraft` + `ensureRequiredParamKeysOnDraft` + compile + `assessCompleteness`.
- 에이전트/harness 없음.
- `messages`에 사용자 발화를 넣지 않는다. (패널 입력은 채팅 로그가 아님)
- `deployable`이면 `status: 'ready'`, 아니면 기존 `planning`.
- 트리거 슬롯은 이미 `applySlotValuesToDraft`가 `trigger` / `triggerType` / `trigger.runAt` 등을 처리한다.

IPC: `ax:applyInterviewPatch(state, patch)` → 세션 persist 후 state 반환.

### 패널이 만드는 patch 키

기존 슬롯 id를 그대로 쓴다.

- `{nodeId}.params.{field}`
- `{nodeId}.memo`
- `trigger` / `triggerType` / `trigger.runAt` / `trigger.schedule` / `local_folder.new_file.folderId` 등

패널은 completeness의 해당 노드 슬롯 + 카탈로그 param 정의로 필드를 나열한다. 질문 문구(`question`)는 필드 레이블/헬프로 쓴다. 채팅으로 보내지 않는다.

### 채팅 메시지

`buildAssistantMessage`:

- 그래프가 있고 빈 슬롯이 있으면 번호 목록 대신 한 문장. 예: “흐름은 이렇게 잡았어요. 비어 있는 노드는 오른쪽에서 채워 주세요.”
- 시작점이 아직 갈리는 경우(폴더 vs 메일 vs 지금)에만 **한 질문**을 채팅에 남겨도 된다. 권장은 trigger 패널의 시작 방식 선택으로 대체.
- `formatBatchedInterviewQuestions`는 프롬프트용으로 남기거나 삭제. **사용자 visible 채팅에서는 제거.**
- `slots/answers.ts` 번호 매핑은 메인 경로에서 제거.

인터뷰 스킬: “빈 값은 코드가 노드 패널에 표시한다. nextQuestion으로 슬롯을 나열하지 마라. 사용자가 채팅으로 값을 말하면 patch만 해라.”

## Implementation Phases

### Phase 1: LLM-less patch + 채팅에서 번호 목록 제거

Goal:
- 패널이 쓸 수 있는 서버 API가 생기고, 채팅이 더 이상 1.2.3.을 출력하지 않는다.

Deliverables:
- `applyInterviewPatch` + 테스트 (슬랙 채널·trigger manual).
- IPC `ax:applyInterviewPatch`, preload, `AxApi`.
- `buildAssistantMessage` / 스킬 / `buildInterviewTurnHints`에서 배치 질문 제거.
- `formatBatchedInterviewQuestions`·`slotAnswersFromUserText` 사용처 정리. 사용자 경로에서 삭제.

Verification:
- `packages/core` 인터뷰 테스트. 번호 목록 테스트는 “채팅에 번호가 없다”로 교체.
- 기존 `applyAnswer` 플로는 유지.

Rollback:
- IPC만 추가하고 UI가 안 부르면 동작 변화는 채팅 문구뿐이다. 스킬 문구는 revert 가능.

### Phase 2: 노드 패널 편집

Goal:
- action 노드에서 빈 required 문자열을 패널에 넣고 즉시 반영.

Deliverables:
- `NodeDetailPanel`을 읽기 전용에서 필드 폼으로 전환.
  - completeness에서 이 노드(`sourceId`)에 해당하는 슬롯만.
  - 카탈로그 label, required 표시, 현재값.
  - 바인딩/ref로 이미 채워진 값은 읽기 전용.
- 저장 시 `applyInterviewPatch`. busy는 짧고 에이전트 progress 문구를 쓰지 않음.
- `WorkflowPreviewPanel`: 그래프 생성/턴 이후 첫 incomplete 노드 자동 선택. (트리거면 `__trigger__`)
- `WorkPage`가 워크플로가 바뀌면 selection을 무조건 지우는 effect를, “같은 노드 유지 + 없으면 첫 빈 노드”로 바꿈.
- 그래프 헤더 `N개 확인 필요`는 유지. 클릭한 노드와 맞으면 충분.

Verification:
- 데스크톱에서 빈 Slack 노드 클릭 → 채널 입력 → 노드 incomplete 해제.
- 패널 저장 후 채팅 히스토리에 채널 문자열이 사용자 메시지로 안 쌓임.

Rollback:
- 패널을 읽기 전용 + “이 부분 수정하기”로 되돌릴 수 있음. patch API는 남겨도 무해.

### Phase 3: 트리거 패널 + 채팅은 수정 전용

Goal:
- 「언제 실행」을 채팅 첫 질문 루프가 아니라 trigger 노드에서 고른다.

Deliverables:
- trigger 패널: 시작 방식 선택.
  - 지금 한 번 → `triggerType=manual`
  - 예약 → schedule/timezone
  - 새 메일 / 새 슬랙 / 폴더 새 파일 → 기존 trigger 필드
- 「이 부분 수정하기」는 구조 변경 탈출구로 유지. 필드 옆이 아니라 패널 하단.
- 시작점이 모호할 때 채팅 한 질문은 optional. 패널이 있으면 채팅에서는 묻지 않는 쪽을 기본으로 한다.
- `applyConversationTrigger`의 「지금」 정규식 확장은 트리거 패널이 대체하므로, 패널 경로에 의존. 채팅 자유 발화의 좁은 매칭(명시적 지금 바로/한번만)은 유지해도 된다. 새로 키우지 않는다.

Verification:
- 트리거 없는 그래프에서 시작 노드 선택 → 지금 한 번 → 채팅이 같은 질문을 반복하지 않음.
- `packages/core` trigger 테스트 + 패널 patch 테스트.

### Phase 4: 연결 안내와 정리

Goal:
- 빠진 연결은 설정으로 보낸다. 죽은 번호-답 코드를 남기지 않는다.

Deliverables:
- `missingConnections`면 패널/채팅에 “설정에서 Slack을 연결해 주세요” + 설정 이동.
- AGENTS.md 단일 구현: 쓰이지 않는 `formatBatchedInterviewQuestions` 사용자 경로, 번호 파서, 관련 테스트 삭제.
- README 인터뷰 UI 문장 갱신.

Verification:
- 전체 참조 검색으로 배치 질문·번호 파서 잔여 없음.
- `packages/core` 테스트, 데스크톱 타입체크.

## Test Plan

```powershell
cd d:\AX_studio\packages\core
npm test -- src/interview src/workflow/visual-display.test.ts

cd d:\AX_studio\apps\desktop
npx tsc --noEmit
```

수동:

1. “폴더 PDF를 읽어 critical/high/normal이면 슬랙·메일로” — 그래프가 뜨고 채팅에 1.2.3.이 없다.
2. 빈 Slack 노드를 열어 채널 입력 — 즉시 반영, 스피너가 인터뷰 AI가 아니다.
3. 시작 노드에서 지금 한 번 선택 — 트리거 질문 루프 없음.
4. 채팅에 “high는 #ops로” — AI patch로 해당 노드만 변경.
5. Slack 미연결 상태에서 연결 안내가 설정으로 이어진다.

## Risks And Assumptions

- 가정: 카탈로그 required 필드는 v1에서 문자열로 충분하다. 채널 피커는 다음에.
- 가정: if 분기 구조는 AI plan이 만들고, 사용자는 패널에서 고치지 않는다.
- 위험: 패널 patch와 동시에 채팅 `applyAnswer`가 돌면 세션이 어긋난다. 패널 저장 중 채팅 전송을 막는다.
- 위험: 워크플로 객체 교체 시 노드 선택 초기화가 패널을 닫아 입력을 날린다. Phase 2에서 selection 보존이 필수다.
- 기존 제품 문장 “빈칸만 인터뷰한다”는 **채팅 인터뷰**가 아니라 **그래프 위 빈칸**으로 재해석한다. 노드를 사용자가 그리는 제품으로 바꾸지 않는다.

## Codex/Claude Prompt

```text
Read docs/plans/node-panel-slot-fill.md. Implement Phase 1 only with the smallest safe patch.
Add applyInterviewPatch (no LLM), IPC, and stop emitting numbered interview questions in chat.
Remove user-facing batched question formatting. Keep applyAnswer for conversational edits.
Reuse existing patch/completeness APIs. Run packages/core interview tests. Report files and results.
```
