# AX Studio North Star Implementation Plan

Status: Proposed (authoritative for *product north star*), amended 2026-08-23  
Scale: Large  
Date: 2026-08-23

Interview and decisions: `docs/research/ax-north-star.md` (including review amendments).  
Current implemented product: `docs/plans/ax-workspace-migration.md`.  
v1 freeze (historical): `docs/plans/ax-studio.md`.

각 페이즈 후 `docs/reports/ax-north-star.phase-N.md`를 남긴다. Phase 0부터 구현한다.

## Goal

연결한 Gmail, Slack, 로컬 문서, RDB, HTTP, Webhook(그리고 OpenAPI/MCP로 등록한 것)을 **하나의 catalog**로 두고, GPT/Claude 앱처럼 대화하는 로컬 앱을 완성한다.

- 평챗: 연결 지식을 검색·분석하고, *이미 저장한* 업무는 실행할 수 있다.
- `/once`, `/workflow`: 없는 일을 그래프 초안으로 짜서 검수한다.
- 라우터: catalog의 tool / skill / 저장 업무를 고른다.
- 호출: Tool Invoker가 first-party · OpenAPI HTTP · MCP client adapter로 실행한다.
- 오케스트레이션: AX Runtime이 trigger · graph · approval · 로그를 소유한다. MCP는 workflow 엔진이 아니다.

한 줄 완료 정의:

> “이거 해줘”면 연결·스킬을 보고 답하거나 기존 업무를 돌리고, 새 자동화는 `/`로 짜서 미리보기에서 검수한다. 사용자는 그 창에서만 일한다.

## Glossary

구현과 문서에서 이 뜻만 쓴다. 기존 코드 용어를 바꾸지 않는다.

| 용어 | 뜻 |
|------|----|
| Connection | 인증·접속 정보 (OAuth, token, DSN, base URL, tunnel URL) |
| Connector | Gmail, Slack, RDB, HTTP 같은 연동 **구현** |
| Tool / Capability | `gmail.message.search`처럼 호출 가능한 기능. catalog 단위 |
| Resource | 메일, 메시지, PDF, DB row. `SourceRef`로 가리킴 |
| Trigger | 새 메일, 새 파일, inbound webhook처럼 워크플로를 **깨우는** 사건 |
| Skill | AI에게 주는 지침. 호출 가능한 tool이 아님 |
| Workflow | tool/trigger를 이은 설계도 (`workflow.json` / IR) |
| Run / Execution | 그 설계도의 한 번 실행. 로그·승인의 단위 |

Webhook의 1급 정체성은 **Trigger**다. 수신 payload는 그 Run의 Resource다.

## Current Facts

- 데스크톱은 대화가 집이다. 좌측 탭은 업무 / 승인 / 활동 / 설정, 세션 목록, 오른쪽 워크플로 미리보기.
- 평챗은 연결 리소스 **읽기 전용** (`runWorkspaceChat` + design-tools). 쓰기는 안내만.
- `/once`·`/workflow`는 interview agent가 draft를 짜고 검수 카드로 실행/저장한다.
- 1급 구현: Gmail, Slack(보내기 중심), 로컬 폴더/PDF, document, RDB **SELECT**, transform.
- HTTP 범용 커넥터와 webhook 런타임은 없다. `triggers/stubs/webhook/`만 예약.
- Slack 채널 읽기는 v1에서 비목표였고, 현재 지식 표면도 약하다.
- OpenAPI/MCP ingest와 MCP client adapter는 없다.
- 도구 선택은 역할 skill + 프롬프트 catalog다. 저장 업무를 평챗에서 고르는 라우터는 없다.
- 쓰기는 runtime + approval. `sideEffect`는 `NONE | REVERSIBLE | EXTERNAL | EXTERNAL_HIGH`.
- workflow row에 `active` 플래그가 있다. 저장 직후 disabled 규범은 아직 문서/UX에 고정되지 않았다.
- 클라우드 provider에는 PDF 본문 design-tool read를 막는다. 로컬 provider만 bounded read.
- Codex CLI / Claude CLI / API / Ollama adapter는 이미 있다. 공유 tool-call 봉투는 provider마다 다르다.
- 배포는 로컬 Electron 트레이 앱. `packages/core`가 런타임.

## Proposed Behavior

### 사용자가 하는 일

1. 설정에서 연결한다. 연결되는 즉시 catalog와 Invoker 표면이 늘어난다.
2. 슬래시 없이 묻는다. `sideEffect=NONE|REVERSIBLE` tool로 메일, Slack, 폴더, DB, HTTP를 조회해 답하고 `Citation`을 붙인다.
3. 이미 있는 업무를 말로 다시 실행한다. list → 모호하면 질문 → store id만 run → 승인 게이트.
4. 없는 자동화는 `/once …` 또는 `/workflow …`만. 그래프가 먼저 나오고, 미리보기와 검수 카드로 고친다. 실행을 막는 누락만 질문한다.
5. `/workflow` 저장은 **disabled**. 사용자가 활성화해야 trigger가 듣는다. `/once`는 workflow를 enabled로 저장하지 않고, 실행 snapshot과 로그는 남긴다.
6. OpenAPI/MCP를 연결하면 catalog에 올라오고, Invoker adapter로 평챗/`/`에서 실제로 호출된다.

### 모드 행렬 (규범)

| 사용자 입력 | 라우터가 해도 됨 | 하면 안 됨 |
|-------------|------------------|------------|
| 평챗 | `sideEffect=NONE\|REVERSIBLE` tool, 지식 검색, 설명, **저장된 업무 실행** (`workflows.list` id만) | 새 Workflow 작성·저장, 임의의 id `run` |
| `/once …` | 그래프 초안 → 검수 → 즉시 실행. execution에 IR snapshot | enabled workflow row 저장 |
| `/workflow …` | 그래프 초안 → 검수 → **saved + disabled** | 확인 없이 덮어쓰기, 저장 즉시 trigger 활성 |
| 설정 | 연결, 터널 URL, 활성화, 승인 완화 | 채팅이 연결 토큰을 묻기 |

사용자에게 보이는 `/` 커맨드는 **두 개**뿐이다.

### Workflow / Run lifecycle

Workflow (설계 문서):

```text
draft → saved (disabled) → enabled | disabled
```

Run (실행 한 건):

```text
queued → running → completed | failed | pending_approval
```

`running`은 workflow row 상태가 아니다.

### 1급 연결

읽기/쓰기는 HTTP method가 아니라 capability `sideEffect`가 결정한다. HTTP method는 ingest **기본값**일 뿐이다 (GET→`NONE`, 그 외→`EXTERNAL`).

| 갈래 | Tool (평챗: NONE/REVERSIBLE) | Tool (쓰기: `/` 또는 저장 업무) | Trigger |
|------|------------------------------|----------------------------------|---------|
| Gmail | 검색·읽기 | draft/send (`EXTERNAL_HIGH` 등) | 새 메일 |
| Slack | 채널/메시지 검색·읽기 | send | 새 메시지 |
| 로컬 문서 | 폴더·PDF·표 | document write | 새 파일 |
| RDB | schema + SELECT (allow-list) | 없음. 쓰기는 HTTP | 없음 |
| HTTP | `sideEffect=NONE`인 request (기본 GET) | `EXTERNAL`/`EXTERNAL_HIGH` request | 없음 |
| Webhook | 없음 (지식 tool 아님) | 없음. 이후 action이 쓰기 | **인바운드 HTTP** |

Webhook 수신: localhost 리스너. 공인 URL은 사용자가 터널을 연결에 붙인다. AX 릴레이 없음.

### 지식

Phase 6 전: bounded list/read/search tool만.  
Phase 6 후: 큰 소스만 로컬 인덱스로 후보를 좁힌 뒤 같은 read tool로 본문을 가져온다.

타입: `SearchHit`, `SourceRef`, `Citation`, `ResourceSnapshot`, `IndexDocument`.

규칙:

- 연결 ACL 밖 문서는 검색되지 않는다.
- 원본 삭제/권한 회수 시 인덱스에서 제거하거나 히트를 무효로 한다.
- stale 히트는 재조회 실패 시 인용하지 않는다.
- 답변에는 `Citation`을 붙인다.
- 클라우드 모델에는 hit snippet 상한만. 소스 전체 덤프 금지.

위키 제품·전체 KG가 아니다. 옵시디언 vault는 폴더 연결로 흡수한다.

### 라우터와 Invoker

Catalog는 **정규화된 tool 목록**이다. 호출은 Invoker다.

```text
Catalog
  ↓
Tool Invoker
  ├─ first-party connector
  ├─ OpenAPI HTTP adapter
  └─ MCP client adapter
Runtime
  Trigger → graph → Invoker / Approval → executions
```

평챗 저장 업무:

```text
workflows.list → 모호하면 질문 → store id만 workflows.run → 게이트 → Runtime
```

### 작성 UX

`/` → 그래프 먼저 → 미리보기 + 검수 카드 → 대화 patch. n8n 캔버스 없음.

### 승인

`EXTERNAL_HIGH`는 항상 승인. `EXTERNAL`은 업무별 게이트(기본 on, 완화 가능). `NONE`/`REVERSIBLE`은 자동. 평챗 `run`에도 동일. HTTP method로 승인하지 않는다.

## Success Criteria

1. 평챗에서 Gmail/Slack/폴더/RDB/`sideEffect=NONE` HTTP를 조회해 답하고, 새 워크플로가 생기지 않는다. 답에 citation이 있다.
2. 평챗에서 **store에 있는** 업무만 실행한다. 모호하면 묻는다. runtime/approval/활동 로그가 남는다. 임의 id는 거부한다.
3. `/once`는 미리보기 → 실행 → enabled workflow 없음. execution에 IR snapshot이 있다.
4. `/workflow`는 검수 → saved+disabled. 사용자가 활성화한 뒤에만 trigger가 돈다. 자동 덮어쓰기 없음.
5. HTTP 연결 하나로 `NONE` request(평챗)와 `EXTERNAL` request(`/` 또는 저장 업무)가 돈다. SSRF allowlist·timeout·크기 상한이 있다.
6. localhost webhook이 **enabled** 업무만 깨운다. 서명/공유비밀, payload 상한. 터널 URL은 표시만.
7. OpenAPI 하나와 MCP 하나를 catalog에 올리고, Invoker adapter로 평챗/`/`에서 **실제로 호출**한다. `sideEffect`가 승인 정책을 탄다.
8. 쓰기 기본 게이트가 동작하고, 업무 설정으로 `EXTERNAL`을 완화할 수 있다.
9. 클라우드 모델에 소스 전체가 나가지 않는다. Phase 6 이후 인덱스는 로컬이며 ACL을 넘지 않는다.
10. 아래 Test Plan 명령이 통과한다.

## Non-Goals

- n8n/Zapier 캔버스 에디터, n8n 또는 MCP를 workflow 엔진으로 사용
- Notion, Jira, Outlook, Teams, Drive, Sheets API, Calendar, Salesforce, 웹 검색, 브라우저 RPA
- DB INSERT/UPDATE/DELETE
- 옵시디언 클론, 전체 지식그래프 엔진
- AX가 운영하는 webhook 클라우드 릴레이
- 플러그인 마켓, 멀티유저, SSO, 사내 Gateway (`docs/future.md`)
- `/run` `/connect` `/tools` 슬래시 팔레트
- 평챗이 새 워크플로를 몰래 작성
- Loop/Parallel/Wait/SubSkill 엔진
- provider 스택 재작성 (기존 CLI/API/Ollama를 새 백엔드로 교체하지 않음)
- `sideEffect` enum 이름을 `none/external-low/external-high`로 바꾸기

## Architecture

```
User (GPT/Claude-like shell)
  ├─ plain chat  → Router
  │                  ├─ read tools via Invoker (catalog id)
  │                  ├─ local retrieval (Phase 6+)
  │                  └─ workflows.list / workflows.run(storeId) → Runtime
  ├─ /once|/workflow → Authoring agent → Draft IR → Preview + Review
  │                      └─ blocking completeness only
  └─ Settings → Connections, enable/disable, OpenAPI, MCP, tunnel URL

Catalog (normalized tool/trigger/skill descriptors)
  ├─ first-party
  ├─ OpenAPI ingested
  └─ MCP ingested

Tool Invoker
  ├─ first-party connector
  ├─ OpenAPI HTTP adapter
  └─ MCP client adapter (session/call; not the workflow engine)

Runtime
  Trigger (incl. webhook) → Engine → Invoker + Approval → executions
  Provider adapters: existing structured output / tool-call envelope
```

경계:

- Agent는 catalog id, IR 초안, `workflows.run(storeId)` 제안까지.
- Invoker만 Gmail SDK / HTTP / MCP protocol을 안다.
- Runtime만 graph, trigger arming (`enabled`), approval, 로그를 안다.
- MCP 세션은 catalog의 진실 공급원이 아니다.
- `workflow.create`는 slash 경로만.

## Implementation Phases

리스크 경계로 나눈다. **Phase 0을 먼저** 닫고 1로 간다.

### Phase 0: Shared contracts

Goal:
- 용어, lifecycle, Invoker 인터페이스, knowledge 타입, 기존 provider tool-call 봉투를 코드 계약으로 고정한다. 새 커넥터 없음.

Deliverables:
- `ToolDescriptor`, `ConnectionDescriptor`, `TriggerDescriptor`, `SkillDescriptor`.
- Workflow lifecycle (`draft | saved | enabled | disabled`) vs Run lifecycle.
- `ToolInvoker` 인터페이스 (first-party | openapi | mcp). first-party 기존 경로를 이 인터페이스 뒤로 얇게 맞춘다.
- Knowledge 타입: `SearchHit`, `SourceRef`, `Citation`, `ResourceSnapshot`, `IndexDocument`.
- 기존 provider(API/CLI/Ollama)의 structured output / tool-call 봉투를 하나의 계약으로 문서화·테스트. 새 provider 추가 없음.
- 승인 판정은 `capability.sideEffect`만. HTTP method 분기 금지 테스트.

Verification:
- 타입/인터페이스 테스트. lifecycle 상태 전환 테스트. 기존 core 테스트 회귀.

Rollback:
- 인터페이스만 제거. 런타임 동작 유지.

### Phase 1: Mode contract in code

Goal:
- 평챗 / `/once` / `/workflow` / `workflows.run` 계약을 고정한다.

Deliverables:
- `create`는 slash-only. `run`은 store id만. 평챗 읽기는 `NONE|REVERSIBLE`.
- 평챗이 interview start / workflow.create를 호출하지 못함.

Verification:
- 평문 → create 없음. 없는 id → run 거부. slash → authoring.

Rollback:
- 정책 모듈 revert.

### Phase 2: Saved-work run from chat

Goal:
- “그 업무 다시 돌려”가 선택 프로토콜을 지킨다.

Deliverables:
- `workflows.list` / `workflows.run`.
- 모호하면 질문. list에 없는 id 거부.
- 기존 `runWorkflow` + 게이트 + 활동 로그.

Verification:
- mock: list→run. unknown id 실패. 수동: 저장 업무 하나 말로 실행.

Rollback:
- 도구만 제거. 업무 탭 실행 유지.

### Phase 3: HTTP connector + baseline security

Goal:
- 아웃바운드 REST가 1급 tool. 보안을 같은 페이즈에 넣는다.

Deliverables:
- `http` connection (base URL, auth). `http.request`.
- ingest 기본값 GET→`NONE`, 그 외→`EXTERNAL`. 최종은 manifest `sideEffect`.
- SSRF: 연결에 적힌 base URL 밖으로 못 나감. timeout, 응답 크기 상한, 재시도/idempotency 기본값.
- 설정 UI. 평챗 `NONE`, `/` 또는 저장 업무 `EXTERNAL`.

Verification:
- mock HTTP. base URL 밖 요청 거부. GET-but-`EXTERNAL_HIGH`면 평챗 거부/승인.

Rollback:
- module unregister.

### Phase 4: Webhook trigger + baseline security

Goal:
- inbound HTTP가 **enabled** 업무만 깨운다.

Deliverables:
- `triggers/webhook` localhost 리스너. disabled면 무시.
- 공유 비밀/서명, payload 크기 상한, localhost bind.
- 터널 URL은 연결 설정 표시만. 릴레이 없음.
- payload → 그 Run의 Resource. webhook knowledge tool 없음.

Verification:
- disabled면 curl이 실행을 안 만듦. enabled면 execution 생성. 잘못된 서명 거부.

Rollback:
- trigger disable → stub.

### Phase 5: Slack read as knowledge

Goal:
- Slack이 평챗 지식 소스가 된다.

Deliverables:
- 검색/읽기 capability + `Citation`/`SourceRef`.
- 보내기는 write + 게이트.
- 기존 RDB SELECT allow-list 유지 (이 페이즈에서 write 열지 않음).

Verification:
- mock Slack read + citation. 수동: 채널 질문.

Rollback:
- read capability 숨김.

### Phase 6: Local retrieval index

Goal:
- 큰 소스만 로컬 인덱스로 좁힌다.

Deliverables:
- `IndexDocument` 로컬 인덱스. 클라우드 임베딩 API 기본 사용 금지.
- ACL 밖 미검색. 삭제/권한 회수 시 tombstone 또는 재조회 실패 시 미인용.
- stale 처리. 클라우드 모델에는 snippet 상한.
- 인덱스가 꺼지면 Phase 5까지의 list/read로 후퇴.

Verification:
- fixture: 관련 파일만 read. 삭제 문서 citation 없음. 클라우드 본문 미전송.

Rollback:
- index off.

### Phase 7: Approval gates per work

Goal:
- `EXTERNAL` 기본 승인, 업무별 완화. `EXTERNAL_HIGH`는 항상 승인.

Deliverables:
- 게이트는 capability `sideEffect` 기준. `http.write` 같은 method 별칭으로 우회하지 않음.
- 검수 카드/업무 설정. 평챗 `run`에도 동일.

Verification:
- 기본 게이트, 완화 후 자동, HIGH는 완화 불가.

Rollback:
- Gmail send 필수 승인으로 축소.

### Phase 8: Authoring = draft then blocking questions

Goal:
- `/` 직후 그래프가 먼저 보인다.

Deliverables:
- 질문은 미연결·게이트 등 차단 조건만.
- `/workflow` 저장 = disabled. 활성화는 명시 동작.
- `/once` execution snapshot.

Verification:
- 연결 있으면 빈칸 심문 없이 draft. 저장 후 trigger 무반응, 활성화 후 반응. once row 없음.

Rollback:
- 기존 slot 질문 경로.

### Phase 9: OpenAPI ingest + HTTP adapter

Goal:
- spec → catalog + Invoker HTTP adapter로 실제 호출.

Deliverables:
- 파서, auth, sandbox 후 catalog commit.
- `sideEffect` 채움. 모르면 `EXTERNAL`.
- Phase 3 보안(base URL, timeout, size) 재사용.

Verification:
- fixture spec GET/POST. 평챗/`/` 호출. 승인 정책 적용.

Rollback:
- ingest 비활성.

### Phase 10: MCP ingest + client adapter

Goal:
- MCP server → catalog + **MCP client adapter로 실제 tool call**.

Deliverables:
- MCP client/session. tool → capability. 실패 시 catalog commit 없음.
- Invoker 경로가 session.call이다. MCP로 graph를 돌리지 않음.
- 결과를 untrusted Resource로 취급. Gmail/Slack을 MCP로 재작성하지 않음.

Verification:
- mock MCP server. 평챗 호출. write tool은 게이트. catalog-only 목록으로 끝나지 않음.

Rollback:
- MCP UI 숨김.

### Phase 11: Hardening and QA

Goal:
- 관측과 최종 E2E. 기본 보안은 3·4에서 이미 있다. 여기는 구멍 메움과 회귀.

Deliverables:
- HTTP/Webhook/MCP 실패를 활동 로그에.
- 경로 traversal, MCP 결과 bound, 인덱스 ACL 재검증.
- 성공 기준 1–10 체크리스트.

Verification:
- Test Plan 전체 + E2E 다섯 개.

Rollback:
- 새 연결을 설정에서 끌 수 있게.

## Test Plan

회귀 (페이즈 마감마다, 해당 패키지가 있으면):

```powershell
npm test
npm run eval
npm exec -- tsc -p apps/desktop/tsconfig.json --noEmit
npm run build
python -m unittest discover -s packages/document-engine/src -p '*_test.py' -v
git diff --check
```

기능 E2E (최종, 수동+mock):

1. 평챗 Slack 조회 → workflow 생성 없음, citation 있음
2. 평챗 저장 업무 실행 → approval/runtime/activity 기록. 없는 id 거부
3. `/once` → 미리보기 → 실행 → enabled workflow 없음, execution snapshot 있음
4. `/workflow` → 검수 → 저장(disabled) → 명시적 활성화 후에만 trigger
5. MCP/OpenAPI read/write → catalog **그리고** Invoker 호출, `sideEffect` 승인 적용

페이즈별 자동화:

- Phase 0: descriptor/lifecycle/invoker/sideEffect 단위 테스트
- Phase 1–2: create vs run, unknown id
- Phase 3–4: mock HTTP, SSRF, webhook signature, disabled ignore
- Phase 5: Slack read mock
- Phase 6: index ACL/stale/dataPolicy
- Phase 7: approval matrix
- Phase 8: blocking questions, save≠enable, once snapshot
- Phase 9–10: fixture OpenAPI + mock MCP **call**
- 실제 Gmail/Slack/터널은 수동

## Risks And Assumptions

- 평챗 `run`이 `create`로 새면 북스타가 깨진다. Phase 0–1이 최우선.
- MCP를 catalog에만 넣고 adapter를 빼먹으면 기준 7이 거짓이다.
- 저장=enabled면 webhook이 즉시 돈다. 기본 disabled.
- HTTP method를 승인 규칙으로 굳히면 OpenAPI가 구멍을 만든다.
- 사용자 터널은 지원 부담. 완료선은 localhost + URL 필드 + 서명.
- Slack 읽기 스코프가 기존 앱 설정을 바꿀 수 있다.
- 가정: 1인 로컬 앱. provider 재작성 없음.

## Codex/Claude Prompt

```text
Read docs/research/ax-north-star.md and docs/plans/ax-north-star.md.
Implement only the named phase. Do not start later phases.
Reuse packages/core catalog, runtime, sideEffect, and desktop settings patterns.
Do not expose workflow.create on the plain-chat tool surface.
Do not treat MCP as the workflow engine. Calls go through Tool Invoker.
Do not use HTTP method as the approval source of truth.
Run this plan’s Test Plan commands that apply to the phase.
Write docs/reports/ax-north-star.phase-N.md.
```

Phase 0 only:

```text
Read this plan. Implement Phase 0 only with the smallest safe patch: shared descriptors, lifecycle vs run, ToolInvoker interface, knowledge types, provider envelope freeze. Reuse existing patterns. Run the smallest relevant checks. Report changed files and verification results.
```
