# Work Discovery 전환 — 연구/결정 기록

Status: Proposed  
Scale: Large  
Date: 2026-08-24  
Baseline: current `main` (`082c53f` 이후 working tree)  
North star: `docs/AX_STUDIO_WORK_DISCOVERY_MASTER_PLAN.md`

이 문서는 마스터 플랜을 다시 쓰지 않는다. **지금 구현된 AX Studio를 그 제품으로 바꾸는 결정**만 고정한다. 구현 순서는 `docs/plans/work-discovery-transition.md`.

---

## Problem

현재 AX는 “자연어로 반복 업무(workflow)를 만들고 실행하는 앱”이다.

목표 제품은 다음 한 줄이다.

> 지난 결과물을 보여주면, 연결된 업무 환경에서 만드는 법을 찾아, 검증된 반복 업무로 컴파일하는 앱.

기술적으로 사용자는 workflow를 설명하지 않는다. PDF/엑셀/메일 같은 **과거 산출물**을 주고, AX가 source를 찾고 replay로 맞춘 뒤 기존 `WorkflowIR`로 컴파일한다.

---

## Current Architecture Facts

Repo에서 확인한 사실만 적는다. 제안 동작은 여기 쓰지 않는다.

### Control plane

- Agent 경계는 `packages/core/src/agent/commands/`다.
- 명령 목록은 `schema.ts`의 `AX_COMMAND_NAMES`: `command.list`, `resource.list`, `source.*`, `capability.*`, `workflow.*`, `execution.enqueue_once`, `ui.present`.
- Desktop/CLI/Agent는 같은 `AxCommandService`를 탄다.
- `discovery.*` 명령은 없다.

### Execution plane

- Canonical 실행 모델은 `packages/core/src/workflow/schema.ts`의 `WorkflowIR`.
- Step 종류: `action`, `ai_decision`, `if`, `human_approval`.
- Runtime은 `packages/core/src/runtime/engine.ts`.
- Approval, side-effect policy, trigger receipts, execution log가 이미 있다.

### Connectors

| Connector | Catalog | Runtime |
|---|---|---|
| gmail | OAuth, search/read/send | 있음 |
| slack | 채널/메시지 | 있음 |
| local_folder | 스캔/읽기 | 있음, worker scan |
| document | Docling ingest | 있음 |
| rdb | `schema.describe`, `query.read` | 있음, read-only |
| local_sheet | `local_sheet.read` | **없음** (`runtimeAvailable: false`, `registration: {}`) |
| transform | table/document → text | 있음 |
| http / webhook | 있음 | 있음 |

### Artifacts

- `DocumentArtifact`, `FileRef`, text artifacts는 있다.
- `TableArtifact` / `WorkbookArtifact` 계약은 catalog IO에 이름만 있고, 마스터 플랜 수준의 typed table/workbook schema는 없다.
- PDF ingest는 page/table/image를 남기지만 Work Discovery용 label-value/path observation은 없다.

### AI decision debt

- `packages/core/src/runtime/ai-investigation.ts`의 `documentTextFromRun` / `emailBodyFromRun`이 `variables`와 `stepResults`를 훑는다.
- `ai_decision` step에 explicit input contract가 없다.
- Discovery가 컴파일한 “DB → AI 코멘트 → PDF” 업무는 이 경로가 있으면 lineage가 끊긴다.

### Persistence

SQLite 테이블: `workflows`, `workflow_versions`, `executions`, `approvals`, `settings`, `connections`, `workspace_chats`, `trigger_receipts`.

Discovery session / example / snapshot / replay case 테이블은 없다.

### Desktop

- 주 화면은 `apps/desktop/src/components/workspace/AxWorkspaceChat.tsx`.
- 빈 화면 예시: “PDF 확인하기”, “반복 업무 만들기”, “연결 확인”.
- 사용자는 텍스트로 일을 설명하는 것이 기본 경로다.
- 첨부/드롭으로 “지난 결과물”을 discovery session에 넣는 first-class UX는 없다.

### Interview leftovers

- `packages/core/src/interview/`는 읽기 호환/컴파일 유틸로 남아 있다.
- 신규 workspace 대화는 command chat으로 간다.

---

## Target Product Loop

```text
지난 결과물 (PDF/xlsx/메일)
        │
        ▼
   Work Discovery (authoring)
        │
   observe → inventory → hypothesize
        │
        ▼
   deterministic replay
        │
   모호하면 최소 질문
        │
        ▼
   DiscoveryBlueprint
        │
        ▼
   기존 WorkflowIR compiler
        │
        ▼
   기존 Runtime / approval / history
        │
        ▼
   baseline → drift → conservative repair
```

자연어 authoring은 예시가 없을 때의 fallback이다. 두 경로는 같은 IR/Runtime으로 수렴한다.

---

## Decision Log

### Decision: Discovery는 Runtime에 넣지 않는다

Context:
- 마스터 플랜 §5.1. 매 실행마다 PDF를 재해석하고 source를 다시 찾으면 반복 실행이 비결정적이 된다.

Options:
- A: Runtime 안에서 매 tick discovery
- B: Authoring/control-plane에서 한 번 배우고, Runtime은 컴파일된 IR만 실행

Decision: **B**

Consequences:
- 새 패키지 `packages/core/src/work-discovery/`는 compiler/authoring이다.
- Runtime 변경은 binding 명시화, transform capability, baseline check처럼 실행에 필요한 최소만.

### Decision: 기존 command/IR/catalog/runtime을 교체하지 않는다

Context:
- `AxCommandService`와 `WorkflowIR`가 이미 Desktop/CLI 수렴점이다.

Options:
- A: 별도 discovery agent/server
- B: 기존 command surface에 `discovery.*`를 추가하고 compile 결과는 기존 `workflow.create`

Decision: **B**

Consequences:
- 새 명령만 추가한다. `workflow.create` 우회 store write는 금지.

### Decision: 첫 E2E는 월간 보고서

Context:
- 마스터 플랜 §2.1. 사용자가 “지난달 PDF 보여주면 다음부터 해”가 killer demo다.

Options:
- A: 메일 분류/슬랙 알림부터
- B: 월간영업보고서.pdf + sqlite/xlsx (+ Gmail 이슈는 후반)

Decision: **B**, v1 source는 `rdb` + `local_sheet` + `document`. Gmail narrative는 Phase 5 이후 선택.

Consequences:
- `local_sheet` runtime이 치명 경로다. 없으면 첫 demo가 막힌다.
- Slack 발송은 기존 capability로 compile만 하면 된다.

### Decision: 합성은 제한 DSL + replay, LLM-only 금지

Context:
- 숫자 하나(`총매출 12.4억`)에도 일치 프로그램이 여러 개다.

Options:
- A: LLM이 WorkflowIR JSON을 직접 생성
- B: `TransformExpr` 후보 나열 → snapshot replay → score → 동점이면 질문

Decision: **B**

Consequences:
- Phase 5 전에 observation/inventory/snapshot이 있어야 한다.
- LLM은 semantic proposal/labeling만. 최종 후보는 evaluator가 결정.

### Decision: 자연어 workflow authoring은 삭제하지 않고 fallback

Context:
- 예시가 없는 업무도 있다. 기존 command chat이 그 경로다.

Options:
- A: NL authoring 즉시 제거
- B: 기본 UX를 “결과물 보여주기”로 바꾸고, 텍스트-only는 fallback

Decision: **B**. 구 경로 삭제는 Discovery publish가 기존 `workflow.run`과 동등해진 뒤.

### Decision: Phase 0로 AI binding 부채를 먼저 갚는다

Context:
- Discovery 컴파일 결과가 `ai_decision`을 많이 만든다.
- 현재 investigation이 런 전체를 scan한다.

Options:
- A: Discovery 먼저, binding은 나중에
- B: explicit input contract를 Discovery 전에 고정

Decision: **B** (마스터 플랜 Phase 0 / WD-001)

Consequences:
- 제품 문장이 바로 나오지 않는 선행 작업이다. 짧고 테스트로 닫는다.

### Decision: v1 repair는 보수적

Context:
- 컬럼 rename remap은 허용. threshold/수신자/approval/AND·OR 자동 변경은 금지.

Decision: 마스터 플랜 Stop 5를 제품 규칙으로 채택.

---

## Architecture Fit

Work Discovery는 세 번째 gateway로 붙는다.

```text
Desktop / CLI / Agent
        │
        ▼
 AxCommandService
   ├─ Workflow Gateway      (유지)
   ├─ Read Gateway          (유지, inventory가 사용)
   └─ Work Discovery Gateway (신규)
            │
            ▼
     WorkDiscoveryService
            │
            ▼
     DiscoveryBlueprint
            │
            ▼
     compile → WorkflowIR → 기존 store/runtime
```

Electron은 파일을 artifact로 import만 한다. Agent는 raw filesystem path를 만들지 않는다.

---

## Data / Security / Privacy

- Discovery read는 host-owned bounded read. Agent에게 shell/SQL/filesystem을 주지 않는다.
- RDB는 계속 allowlist + read-only. raw SQL synthesis 금지.
- Replay는 live connector가 아니라 snapshot.
- 외부 발송(Gmail/Slack)은 기존 approval/sideEffect 정책을 그대로 탄다.
- Output contract 실패 시 외부 발송 중지 (마스터 플랜 차별 4).
- 예시에 개인정보가 있으면 artifact store에 남는다. retention은 기존 local data root 정책을 따른다.

---

## Rollout / Rollback

- 기존 workflow는 `origin` 없으면 `manual/legacy`로 실행. baseline 없으면 현재 semantics.
- Discovery는 feature flag 없이 명령/UI를 추가하는 방식으로 간다. 미완성 discovery는 publish가 막히면 기존 앱이 깨지지 않는다.
- 각 Phase는 독립 커밋. 실패 시 해당 Phase 파일만 revert.
- NL chat은 Phase 8 전까지 기본 경로로 남긴다.

---

## Verification Strategy

모든 Phase:

1. core unit/integration test
2. 관련 fixture replay (Phase 5+)
3. `npm test -w @ax-studio/core` 또는 문서에 적은 최소 명령
4. Desktop 변경 시 typecheck + 해당 UX smoke

제품 성공의 정의는 LLM confidence가 아니라 **historical replay PASS**다.

---

## Mapping To Master Plan

| 전환 Phase | 마스터 플랜 |
|---|---|
| 0 AI binding | §22, §72 Phase 0, WD-001 |
| 1 Artifacts + local_sheet | §6.2–6.3, §20, §72 Phase 1, WD-002/003 |
| 2 Session/commands | §6.11, §23, §26, §72 Phase 2, WD-004 |
| 3 Output observation | §8, §72 Phase 3, WD-005 |
| 4 Source inventory | §9, §19, §72 Phase 4, WD-006 |
| 5 Synthesis/replay | §10–11, §13–14, §72 Phase 5, WD-007 |
| 6 Clarification | §12, §72 Phase 6, WD-008 |
| 7 Compile/publish | §29, §59, §72 Phase 7, WD-009 |
| 8 Desktop UX | §31–35, §72 Phase 8 |
| 9 Baseline/drift | §15–16, §72 Phase 9, WD-010 |
| 10 Repair | §17, §72 Phase 10, WD-011 |

마스터 플랜의 논문/졸작 섹션(§79–83)과 범용 program synthesis는 이 전환 범위 밖이다.

---

## Assumptions (owner-confirmed by “저거 기반으로”)

1. 제품 기본 문장을 Work Discovery로 바꾼다.
2. 기존 IR/Runtime/command/catalog를 보존한다.
3. 첫 세로 슬라이스는 월간 보고서 PDF + DB/엑셀 숫자 매칭이다.
4. 자연어 authoring은 fallback으로 남긴다.
5. Publish 전 replay 게이트는 필수다.

남은 구현 세부(질문 카피, 정확한 Transform op 집합)는 마스터 플랜 기본값을 따른다. 새 제품 결정이 필요하면 구현 중 인터뷰를 다시 연다.
