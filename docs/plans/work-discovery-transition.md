# Work Discovery 전환 구현 계획

Status: Proposed  
Scale: Large  
Research: `docs/research/work-discovery-transition.md`  
North star: `docs/AX_STUDIO_WORK_DISCOVERY_MASTER_PLAN.md`

구현 에이전트는 이 계획의 **현재 Phase만** 구현한다. 마스터 플랜 7,800줄을 한 번에 넣지 않는다. 각 Phase가 끝나면 `docs/reports/work-discovery-transition.phase-N.md`를 남긴다.

---

## Goal

현재 “말로 반복 업무를 만드는 앱”을, 아래 제품으로 바꾼다.

> 지난 결과물을 보여주면, 연결된 데이터에서 만드는 법을 찾아, replay로 검증한 뒤 기존 Runtime이 실행하는 반복 업무로 컴파일한다.

완료 상태의 사용자 경로:

1. 지난달 `월간영업보고서.pdf`를 붙인다.
2. AX가 연결된 sqlite/xlsx에서 숫자·표의 출처를 찾는다.
3. 과거 예시 replay가 PASS인 업무안을 보여준다.
4. 사용자가 “이대로 맡기기”를 누르면 기존 `WorkflowIR`이 저장되고 스케줄 실행된다.
5. 다음 달 결과가 과거 범위에서 벗어나면 외부 발송을 멈추고 이유를 보여준다.

---

## Current Facts

- 제어면: `packages/core/src/agent/commands/` (`AxCommandService`)
- 실행면: `WorkflowIR` + `packages/core/src/runtime/engine.ts`
- PDF ingest: `DocumentArtifact` (page/table/image)
- RDB read-only: `rdb.schema.describe`, `rdb.query.read`
- `local_sheet.read`는 catalog만 있고 runtime 없음
- `discovery.*` 명령/테이블/UI 없음
- Workspace 빈 화면은 자연어 예시 3개
- `ai_decision`이 `stepResults`를 훑어 document/email을 추측함

---

## Proposed Behavior

- 기본 질문은 “어떤 자동화를 만들까요?”가 아니라 “지난번 결과물을 보여주세요.”
- Work Discovery는 authoring이다. 실행은 컴파일된 IR만 돌린다.
- 숫자 매칭은 제한 DSL 후보 + snapshot replay다. LLM이 IR을 직접 쓰지 않는다.
- 예시가 없으면 기존 command chat fallback.
- 기존 workflow는 그대로 실행된다.

---

## Success Criteria

v1 (Phase 0–8):

- fixture PDF의 `총매출` 값이 sqlite/xlsx 집계와 replay로 일치한다.
- 모호한 1-example은 질문 1개, 2-example은 질문 없이 해소된다.
- publish된 workflow가 기존 Runtime에서 실행된다.
- Desktop에서 JSON/CLI 없이 첨부 → 검토 → 맡기기가 된다.
- `npm test -w @ax-studio/core`와 desktop typecheck가 통과한다.

v1.1 (Phase 9–10):

- silent output degradation이 외부 발송을 막는다.
- rename remap repair는 사용자 승인 후에만 새 버전을 만든다.

---

## Non-Goals

- 범용 program synthesis, unrestricted SQL/shell
- 새 Runtime / 새 Agent 프레임워크
- 모든 SaaS connector
- pixel-perfect PDF 복원, OCR 연구 제품화
- 자연어 authoring 즉시 삭제
- 논문/졸작 eval 파이프라인 전체 (`마스터 플랜 §60–83`)
- Slack/Gmail을 첫 Phase의 필수 source로 넣기

---

## Architecture

```text
AxCommandService
  ├ workflow.*          유지
  ├ source.* / capability.*  유지 (inventory가 사용)
  └ discovery.*         신규

packages/core/src/work-discovery/
  observation / exploration / synthesis / validation
  clarification / compile / repair

compile → WorkflowIR → workflow store → existing Runtime
```

UI 용어 금지: `WorkflowIR`, `TransformExpr`, `CandidateProgram`, `ReplayCase`.  
사용자 용어: 지난 결과물, 찾은 방법, 재현 결과, 맡기기, 결과 이상.

---

## Global Rules For Every Phase

1. 기존 `AxCommandService`, `WorkflowIR`, catalog, approval, Runtime을 우회하지 않는다.
2. Agent에게 shell, raw SQL, arbitrary path를 주지 않는다.
3. 새 기능은 schema/test가 먼저다. 긴 프롬프트로 실패를 덮지 않는다.
4. 다른 Phase 파일을 미리 만들지 않는다. 현재 Phase 범위만.
5. 끝나면 해당 evaluator를 돌리고 phase report를 쓴다.
6. dirty worktree의 무관한 사용자 변경을 되돌리지 않는다.

---

## Implementation Phases

리스크 경계로 나눈다. 의존 그래프:

```text
Phase 0 AI binding
      │
      ├──────────────┐
      ▼              ▼
Phase 1 Artifacts   Phase 2 Persistence/Commands
      │              │
      └──────┬───────┘
             ▼
       Phase 3 Observe
             │
             ▼
       Phase 4 Inventory
             │
             ▼
       Phase 5 Synthesize/Replay
             │
             ▼
       Phase 6 Clarify
             │
             ▼
       Phase 7 Publish
             │
       ┌─────┴─────┐
       ▼           ▼
Phase 8 UX     Phase 9 Drift
                   │
                   ▼
              Phase 10 Repair
```

Phase 1과 2는 0 이후 병렬 가능. 8은 7과 일부 병렬 가능하나, 첨부 import는 1의 ArtifactStore에 의존한다.

---

### Phase 0: AI decision explicit binding

Goal:
- Discovery가 나중에 컴파일할 `DB → AI 코멘트` 경로의 lineage를 지금 고정한다.
- `ai_decision`이 런 전체를 훑지 않게 한다.

Why this boundary:
- 데이터플로 계약 부채. 여기가 남으면 replay provenance가 실행 때 사라진다.

Current files:
- `packages/core/src/workflow/schema.ts` — `AiDecisionStepSchema`에 input contract 없음
- `packages/core/src/workflow/port-binding.ts`, `packages/core/src/workflow/bindings.ts`
- `packages/core/src/workflow/contract-validator.ts`
- `packages/core/src/runtime/ai-investigation.ts` — `documentTextFromRun`, `emailBodyFromRun`
- `packages/core/src/runtime/ai-investigation.test.ts`

Deliverables:
- `ai_decision`에 `inputContracts` 또는 동등한 explicit bindings
- `inferStepBindings` / contract validator가 action뿐 아니라 ai_decision input을 검사
- investigation context는 bound 값만 사용
- 기존 fixture를 explicit binding으로 이주
- scan fallback은 warning 후 테스트에서 사용 금지. 마이그레이션 기간에만 코드 존재 가능

Verification:

```powershell
npm test -w @ax-studio/core -- src/runtime/ai-investigation.test.ts src/workflow/contract-validator.test.ts
```

- Document→AI→Slack fixture가 whole `stepResults` scan 없이 통과
- bound되지 않은 필드를 AI가 읽으면 validation 실패

Rollback:
- schema 필드는 optional로 시작하고, fallback 제거는 이 Phase 안에서 테스트를 그린 뒤

Stop if:
- AI prompt에 “이전 스텝을 알아서 찾아라”가 남아 있음

Report: `docs/reports/work-discovery-transition.phase-0.md`

Codex/Claude prompt:

```text
Read docs/plans/work-discovery-transition.md Phase 0 and docs/research/work-discovery-transition.md.
Implement Phase 0 only: explicit ai_decision input bindings. Do not start work-discovery/.
Reuse existing WorkflowIR/port-binding/contract-validator. Migrate fixtures. Run the Phase 0 tests.
Write docs/reports/work-discovery-transition.phase-0.md.
```

---

### Phase 1: Table/Workbook artifacts + local_sheet runtime

Goal:
- 엑셀/CSV/RDB rows가 같은 `TableArtifact`로 움직이게 한다.
- `local_sheet.read`가 실제로 파일을 읽는다.

Why this boundary:
- 첫 E2E의 source가 sqlite와 xlsx다. 시트 runtime이 없으면 관측/합성이 시작되지 않는다.

Current files:
- `packages/core/src/contracts/artifacts/` — Document/FileRef/text만 있음
- `packages/core/src/modules/packages/local-sheet.ts` — `registration: {}`
- `packages/core/src/modules/packages/catalog-data.ts` — `runtimeAvailable: false`
- `packages/core/src/workflow/contract-adapters.ts` — `TableArtifact` 이름만 참조
- RDB `rdb.query.read`는 이미 `rows: TableArtifact`를 공칭

Deliverables:
- `TableArtifact` / `WorkbookArtifact` Zod 계약 (마스터 플랜 §6.2–6.3 최소 필드)
- ArtifactStore: sha 기반 파일 보존, message attachment가 restart 후에도 남음
- `local_sheet` connector: csv/xlsx → WorkbookArtifact → sheet TableArtifact
- `runtimeAvailable: true`로 올리고 instantiate 등록
- row limit / 시트 수 limit (마스터 플랜 값)
- Excel을 단일 CSV string으로 flatten하지 말 것 (Stop 6)

Verification:

```powershell
npm test -w @ax-studio/core -- src/contracts src/modules
```

Fixture:
```text
fixture.xlsx → WorkbookArtifact → Sheet TableArtifact → profile columns
```

Rollback:
- catalog flag를 다시 `false`로 두면 Desktop은 기존처럼 시트를 안 쓴다. schema는 additive.

Report: `docs/reports/work-discovery-transition.phase-1.md`

Codex/Claude prompt:

```text
Read docs/plans/work-discovery-transition.md Phase 1. Implement TableArtifact, WorkbookArtifact, ArtifactStore, and local_sheet runtime only. Do not add discovery commands or synthesis. Run Phase 1 tests and write the phase report.
```

---

### Phase 2: Discovery persistence + command skeleton

Goal:
- 발견 세션이 프로세스 재시작 후에도 살아 있다.
- 합성 없이 start/inspect/cancel만 동작한다.

Why this boundary:
- API/data plane. UI와 알고리즘보다 session 수명이 먼저다.

Current files:
- `packages/core/src/store/db.ts` — discovery 테이블 없음
- `packages/core/src/agent/commands/schema.ts` — `AX_COMMAND_NAMES`
- `packages/core/src/agent/commands/service.ts`
- `apps/desktop/electron/preload/index.ts`, `apps/desktop/src/types/ax-api.ts`

Deliverables:
- SQLite:
  - `work_discovery_sessions`
  - `work_discovery_examples`
  - `work_discovery_snapshots` (컬럼만, writer는 Phase 4–5)
  - `work_discovery_replay_cases` (컬럼만)
- 상태 머신 최소값: `collecting_examples` | `cancelled` | (reserved)
- 명령:
  - `discovery.start`
  - `discovery.inspect`
  - `discovery.cancel`
- `discovery.start` args: `goal`, `exampleArtifactIds` (1–3), optional `inputArtifactIds`
- artifact id는 Desktop import 결과다. raw `C:\...` 금지
- start는 긴 분석을 블로킹하지 않는다 (마스터 플랜 권장 A: async + inspect)
- `WorkDiscoveryService` skeleton만. observe/synthesize 호출 없음
- CLI: `ax discovery inspect <sessionId>`

Verification:

```powershell
npm test -w @ax-studio/core -- src/agent/commands src/store
```

- start → 프로세스 재오픈 → inspect가 같은 sessionId/state
- cancel 후 start된 분석이 진행되지 않음 (이후 Phase에서 runner가 이 플래그를 존중)

Rollback:
- 명령은 allowlist에서 빼면 Desktop이 호출하지 않음. 테이블은 additive.

Report: `docs/reports/work-discovery-transition.phase-2.md`

Codex/Claude prompt:

```text
Read docs/plans/work-discovery-transition.md Phase 2. Add discovery SQLite tables, WorkDiscoveryService skeleton, and discovery.start/inspect/cancel commands only. No observation or synthesis. Persist across restart. Tests + phase report.
```

---

### Phase 3: Output observation

Goal:
- 지난 결과물 PDF/표에서 “무엇을 재현해야 하는지”를 structured observation으로 뽑는다.

Why this boundary:
- 합성 search space의 타깃이 없으면 후보를 만들 수 없다.

Depends on: Phase 1 artifacts, Phase 2 session.

Deliverables:
- `packages/core/src/work-discovery/observation/`
- deterministic first: number parser, label-value, table cells, section headings
- semantic path 예: `summary.total_revenue`, `sections.contract_issues`
- stable vs dynamic 분류 (회사명 vs 이번 달 숫자)
- DocumentEngine 확장은 observation에 필요한 provenance(page/bbox/text)만. OCR 품질 프로젝트 금지
- session state: `observing_output`
- inspect 결과에 observations[] (사용자 화면 용어는 “결과물에서 찾은 항목”)

Verification:
- gold fixture PDF에서 `총매출` 숫자 + label recall
- 페이지 provenance가 있는 critical field

```powershell
npm test -w @ax-studio/core -- src/work-discovery/observation
```

Stop if:
- observation이 PDF binary hash 비교이거나, 통짜 text dump만 남김

Report: `docs/reports/work-discovery-transition.phase-3.md`

---

### Phase 4: Source inventory / profiles

Goal:
- 연결된 환경을 통째로 모델에 넣지 않고, observation에 관련 있는 source만 bounded read한다.

Depends on: Phase 3.

Deliverables:
- module discovery adapter. `WorkDiscoveryService`에 `if connector ===` 남발 금지 (Stop 1)
- RDB: richer schema, structured query, aggregate, profile. **raw SQL 없음**
- local_sheet profile: 컬럼명/타입/샘플/null ratio
- 탐색 budget + cache
- source relevance score
- snapshot writer의 스키마를 여기서 채워도 되지만, live replay는 아직 금지
- Gmail은 metadata/search adapter만 넣고, 첫 숫자 E2E에 필수로 쓰지 않음
- inspect: 후보 source 목록 (사용자 용어 “찾아본 자료”)

Verification:
- output-only example에서 gold sqlite table Recall@K fixture
- budget 초과 시 탐색 중단 + inspectable reason

```powershell
npm test -w @ax-studio/core -- src/work-discovery/exploration
```

Report: `docs/reports/work-discovery-transition.phase-4.md`

---

### Phase 5: Constrained synthesis + replay

Goal:
- “이 숫자는 이 테이블의 이 집계”라는 후보를 만들고, snapshot replay로 걸러낸다.

Depends on: Phase 3–4. **이 Phase가 제품 가설의 판정 지점이다.**

Deliverables:
- `TransformExpr` DSL v1: source, column, filter, aggregate, ratio, lookup, select, sort, limit
- v1에 없는 것: arbitrary JS, raw SQL, loops, 외부 write
- enumerator: direct scalar, sum/count/avg, common filters, ratio
- LLM semantic proposals는 allowlisted op로만 materialize
- scoring: replay match >> heuristic; simplicity prior; confidence와 score 분리
- snapshot replay runner. live connector 호출 금지 (Stop 3)
- 동점 후보는 버리지 않고 retain (Phase 6 입력)
- 1-example exact match를 high confidence로 올리지 않음 (Stop 8)
- inspect: ranked candidates + replay pass/fail (사용자 용어 “재현 결과”)

Golden E2E:
1. PDF `총매출 12.4억` ↔ `SUM(sales.amount)` PASS
2. 두 번째 숫자/비율 매핑 PASS

Verification:

```powershell
npm test -w @ax-studio/core -- src/work-discovery
```

Stop if:
- 알고리즘이 Agent prompt 수백 줄로 들어감 (Stop 2)
- PDF binary diff로 fail (Stop 7) → semantic comparator를 이 Phase에서 고칠 것

Report: `docs/reports/work-discovery-transition.phase-5.md`

성공 기준 (제품):
- CLI/테스트만으로 “지난 결과물 → 만드는 법 재현”이 증명된다. UX는 아직 투박해도 된다.

---

### Phase 6: Clarification

Goal:
- 후보가 여러 개일 때 코드가 질문 문장을 하드코딩하지 않고, 정보이득이 큰 질문 1개를 계약으로 반환한다.

Deliverables:
- ambiguity detector (tie / incompatible filters)
- `ClarificationQuestion`: field/path/type/reason + 선택지
- `discovery.answer`
- 1-example E2E: 질문 발생
- 2-example E2E: 질문 없이 resolve
- Desktop card는 최소. 이 Phase는 command/test가 본체. 예쁜 UI는 Phase 8

Verification:
- answer 적용 후 candidate set이 줄어들고 replay가 유일 PASS

Report: `docs/reports/work-discovery-transition.phase-6.md`

---

### Phase 7: Blueprint compile + publish

Goal:
- 검증된 DiscoveryBlueprint를 기존 `WorkflowIR`로 컴파일하고, 기존 Runtime에서 실행한다.

Why this boundary:
- 여기서부터 “반복 업무”가 된다. 그 전까지는 authoring session이다.

Deliverables:
- `DiscoveryBlueprint` (마스터 플랜 §6.10 최소)
- transform capability가 Runtime에서 blueprint expression을 실행 (새 엔진 금지)
- compiler: blueprint → `WorkflowIR`
- 기존 `workflow.validate` 통과
- `discovery.publish` → 기존 `workflow.create`/`workflow.update`와 같은 store
- atomic publish. draft workflow 수십 개 금지 (Stop 4)
- replay publication gate: 지정된 historical cases PASS 전에 publish 거부 (마스터 플랜 §59)
- published workflow `origin: discovery`
- 스케줄 trigger 추론은 사용자 `desiredRecurrence` 또는 안전한 manual. 추측 cron 남발 금지

Verification:
- publish 후 `workflow.run`이 기존 engine에서 성공
- gate 실패 시 store에 workflow가 생기지 않음

```powershell
npm test -w @ax-studio/core -- src/work-discovery/compile src/runtime/engine.test.ts
```

Report: `docs/reports/work-discovery-transition.phase-7.md`

---

### Phase 8: Desktop UX — 결과물이 기본 경로

Goal:
- 사용자가 JSON/CLI 없이 killer demo를 끝낸다.
- 앱의 기본 문장이 Work Discovery로 바뀐다.

Depends on: Phase 1 ArtifactStore, Phase 7 publish.

Deliverables:
- Workspace 빈 화면:
  - 기본 CTA: “지난 결과물을 보여주세요”
  - fallback: 기존처럼 말로 만들기
- 파일 picker / drag-drop → artifact import → `discovery.start`
- progress: 찾는 중 / 재현 중 / 질문이 있음 / 맡길 수 있음
- 검토 화면: 찾은 항목, 재현 PASS/FAIL, 맡기기 버튼
- `useWorkspaceChat`이 discovery 명령을 호출. 구 검토 카드/직접 실행 IPC를 되살리지 않음
- copy: 내부 타입명 노출 금지 (`docs/AX_STUDIO_WORK_DISCOVERY_MASTER_PLAN.md` §77 참고)
- Electron IPC: artifact import + discovery 명령 passthrough만. Desktop이 합성하지 않음

Verification:
- Desktop typecheck
- smoke: 첨부 → inspect 상태가 UI에 보임 → publish → 기존 workflow 목록에 등장
- 브라우저/Electron에서 첨부 없는 텍스트 fallback이 아직 동작

Report: `docs/reports/work-discovery-transition.phase-8.md`

제품 전환의 사용자 가시 완료 지점. Drift/repair는 그 다음.

---

### Phase 9: Baseline / drift

Goal:
- 실행 HTTP 200이 아니라 “업무 결과가 정상 범위인지”를 본다.

Deliverables:
- output contract / baseline from historical examples
- execution 후 semantic compare (섹션 누락, 수치 범위, source field 소실)
- 실패 시 외부 발송 중지. 기술 성공 vs 결과 실패를 로그/UI에 분리
- input schema drift detector
- `execution.explain`은 최소: 왜 막혔는지 inspectable reason

Verification:
- silent degradation E2E: 고객 수 80–120 → 3이면 Slack/Gmail send 안 함

Report: `docs/reports/work-discovery-transition.phase-9.md`

---

### Phase 10: Conservative repair

Goal:
- 깨진 매핑을 고치는 제안을 하되, 업무 의미는 자동 변경하지 않는다.

Deliverables:
- rename/remap candidate only
- 모든 historical replay PASS 후에만 apply 가능
- `repair.list` / `inspect` / `apply` / `reject`
- apply는 새 workflow version + rollback 가능
- 금지: threshold, recipient, approval, AND/OR, schedule, side effect 자동 변경 (Stop 5)

Verification:
- rename fixture 3/3 replay → user apply → new version → 의미 변경 없음

Report: `docs/reports/work-discovery-transition.phase-10.md`

---

## Test Plan

공통:

```powershell
npm test -w @ax-studio/core
npm run build -w @ax-studio/core
```

Desktop을 만진 Phase (1 import, 2 commands, 8 UX):

```powershell
npx tsc --noEmit -p apps/desktop
```

Phase 5+는 마스터 플랜 E2E 1–4 fixture를 `packages/core/src/work-discovery/eval/fixtures`에 둔다.  
Phase 9–10은 E2E 5–6. Prompt injection(E2E 7)은 Phase 5 observation/synthesis에 최소 가드 + Phase 8에서 재확인.

---

## Per-Phase Report Requirements

각 `docs/reports/work-discovery-transition.phase-N.md`에 반드시:

- 구현한 것 / 의도적으로 안 한 것
- 재현한 fixture (어떤 과거 예시가 PASS/FAIL인지)
- 막은 failure mode (Stop criteria 중 해당 항목)
- 명령과 검증 결과
- 다음 Phase를 막는 남은 구멍
- diff 범위가 이 Phase 경계를 넘었으면 왜인지

---

## Risks And Assumptions

- `local_sheet` native/xlsx 파서가 데스크톱 패키징에 새 native dep를 요구할 수 있다. 가능하면 순수 JS 파서를 쓴다.
- Docling 품질이 나쁜 스캔 PDF면 observation recall이 낮아진다. v1은 native-text PDF fixture로  quantifies하고, 스캔은 non-goal.
- RDB `query.read`가 지금 `SELECT * LIMIT N` 수준이면 Phase 4에서 structured aggregate를 확장해야 한다. Runtime 정책을 풀지 않는다.
- Phase 8 전에 NL UX가 기본으로 남아 있어, 중간에 “제품이 안 바뀐 것처럼” 보인다. 의도된 순서다.
- 마스터 플랜 기준 커밋 `666a3fc` 이후 코드가 이미 더 있다. 파일 경로가 다르면 **현재 코드를 보존하고 이 계획을 맞춘다.**

---

## Suggested Commit Shape

- `wd-p0: explicit ai_decision bindings`
- `wd-p1: table artifacts and local_sheet runtime`
- `wd-p2: discovery session commands`
- `wd-p3: output observation`
- `wd-p4: source inventory`
- `wd-p5: transform synthesis and replay`
- `wd-p6: discovery clarification`
- `wd-p7: compile blueprint to workflow IR`
- `wd-p8: teach-by-example desktop path`
- `wd-p9: output baseline and drift gate`
- `wd-p10: conservative repair proposals`

---

## What To Implement First Tomorrow

Phase 0만. 데모 문장은 Phase 5(테스트) / Phase 8(앱)에서 나온다.

---

## Codex/Claude Prompt (full program, still one phase at a time)

```text
You are converting AX Studio to a teach-by-example app.
Read:
- docs/research/work-discovery-transition.md
- docs/plans/work-discovery-transition.md
- docs/AX_STUDIO_WORK_DISCOVERY_MASTER_PLAN.md (only the sections cited by the current phase)

Implement the current phase only. Do not create later-phase files.
Keep AxCommandService, WorkflowIR, catalog, approval, and Runtime.
Never give the agent shell, raw SQL, or raw filesystem.
After tests pass, write docs/reports/work-discovery-transition.phase-N.md.
```
