# AX Studio Implementation Plan

Status: **Frozen** — 제품/아키텍처/v1 범위 고정. 새 아이디어는 `docs/future.md`에만 적고 이 문서 범위를 넓히지 않는다.  
Scale: Large

## Goal

자연어 업무 지시를 받아 적응형 인터뷰로 업무 계약을 완성하고, 로컬 트레이 앱에서 Skill로 백그라운드 실행하는 1인 AX 제품을 만든다.

사용자는 노드를 그리지 않는다. “이 일 해줘”라고 말하고, 되묻는 직원에게 답한 뒤, 테스트하고 맡긴다.

연결된 것은 Gmail, Slack, 읽기 전용 RDB, 로컬 표, 보고서 렌더러다. 조사는 웹 검색이 아니라 그 안에서만 한다.

## North star vs v1

한 줄:

> AX Studio는 사용자가 연결한 데이터와 시스템의 권한 범위 안에서, 자연어로 지시한 업무를 스스로 요구분석하고 실행 가능한 Skill로 구성하여, 정보 수집·조사·판단·시스템 실행·사람 승인·보고·지속적 개선까지 수행하는 범용 AI 업무 실행 플랫폼이다.

철학:

> 연결한다. 말로 맡긴다. 일이 끝날 때까지 수행한다.

정확한 기술 의미: **부여된 capability와 권한 안에서** 수행 가능한 디지털 업무를 자연어로 조합한다. 아무 회사 시스템이나 내장하는 제품이 아니다.

### First-party 연결 (우리가 직접 만든다)

외부 SaaS는 이 두 개만 1급이다. 나머지는 로고를 늘리지 않는다.

| 갈래 | 연결 | 하는 일 |
|---|---|---|
| 메일 | Gmail | 검색·읽기·draft·승인 후 send, new mail trigger |
| 메신저 | Slack | 보내기. 알림·요약·보고 채널 |
| 데이터 | RDB | SQL capability. v1은 Postgres + SQLite 파일, SELECT만. 이후 방언은 드라이버만 |
| 파일 | 로컬 CSV/xlsx/DOCX/PDF | 읽기·추출. Google Sheets/Drive API가 아님 |
| 보고 | HTML/DOCX → PDF | 양식 채우기, 표·차트, Slack/메일로 전달 |

조사는 **웹 검색이 아니라** 위 read capability 조합이다 (RDB + Gmail + 로컬 표).

### First-party로 안 만든다

Outlook, Teams, Google Drive, Google Sheets, Calendar, Docs, Microsoft 365, SharePoint, Notion, Salesforce, HubSpot, Jira, 특정 ERP/CRM/HRIS, GitHub/GitLab, 웹 검색, 브라우저 RPA를 **제품 내장 커넥터로 약속하지 않는다.**

같은 일을 하고 싶으면:

- 데이터가 DB에 있으면 RDB
- 파일이면 로컬 문서
- 그 외 사내 시스템은 나중에 **Connector SDK / OpenAPI → capability 등록**. 업무를 새로 코딩하지 않는다

n8n/MCP는 필수 runtime이 아니다. 상호운용은 선택이다.

### v1이 증명하는 것

위 first-party 다섯 갈래로 서로 다른 업무를 자연어로 만든다. primitive는 그대로 Trigger / Action / AI Decision / IF / Human Approval.

v1에 안 넣는다: DB write, SQL 방언 추가, OpenAPI SDK, Loop/Parallel/SubSkill/Wait, 회사 PDF 영역 찍기.

## Current Facts

- 저장소는 비어 있다. 구현된 코드/OpenWiki 없음.
- 인터뷰로 제품 결정이 고정됐고, 연결 범위는 Gmail/Slack/읽기 전용 RDB/로컬 표/HTML·DOCX 보고로 좁혔다.

## Proposed Behavior

1. 트레이 앱이 상시 실행된다. 창 닫기 ≠ 퇴근.
2. 사용자는 **대화**에서 업무를 지시한다.
3. 시스템은 모든 슬롯을 묻지 않는다. 현재 IR 그래프에서 **requiredness rules**가 필수인 빈칸만 인터뷰한다.
4. 이해한 업무를 Skill 계약으로 보여준다. 테스트 실행 후 “이대로 맡기기”.
5. Runtime이 Skill을 실행한다. LLM은 판단만 하고, side effect는 Runtime만 수행한다. 메일 본문은 untrusted data다. 조사가 필요하면 AI Decision이 추가 read를 요청하고, 없는 capability는 환각하지 않고 연결을 요구한다.
6. Slack 알림과 Gmail draft는 자동. **Gmail send와 보고서 외부 발송**은 승인함에서 멈출 수 있다.
7. 창이 닫혀 있고 승인이 필요하면 트레이 알림/배지로 노크한다.
8. 이후 지시(“10%만 떨어져도 알려줘”, “이번 달 중지”, “왜 안 올라왔어?”, “앞으로 매달 해줘”)는 기존 Skill 수정·pause·일회 실행을 Skill로 저장·이력 조회다.

화면은 네 개만 쓴다. n8n 용어를 노출하지 않는다.

- 업무: 맡은 Skill
- 대화: 새 지시 / 기존 업무 수정
- 승인: 직원이 노크한 결재
- 활동: 오늘 한 일 / 실패 이유

## Success Criteria

- 메인 데모: 실제 Gmail 문의 → 분류 → Slack 알림 + Gmail draft → 승인함에서 전송 승인 → 실제 발송. 창을 닫아도 런타임은 살아 있고, 승인 필요 시 트레이가 알린다.
- 조사·보고 데모: 읽기 전용 RDB(또는 로컬 표) + Gmail에서 근거를 모은 뒤 HTML 양식으로 PDF를 만들고, 급락/외부 발송은 승인 후 Slack.
- Phase 3에서 10~20 gold 시나리오로 Direct vs Interview를 측정한다. Electron/OAuth 이전이다.
- `gmail.send`와 DB write는 Human Approval/정책 없이 호출 자체가 불가능하다. v1에서 DB write는 호출 표면이 없다.
- AI Decision 출력은 선언된 schema만 허용한다. 모델이 tool/action을 고르지 못한다.
- 웹 검색 없이, 연결된 read capability만으로 조사 스텝이 돈다.

## Non-Goals

- SaaS, 회원가입, 멀티테넌트, 사내 SSO
- n8n/Zapier/OpenClaw 연동 또는 대체
- 커넥터 마켓. Outlook, Teams, Drive, Sheets, Calendar, Notion, Salesforce, HubSpot, Jira, GitHub를 1급 커넥터로 만들지 않음
- HTTP 범용 호출을 v1에 넣지 않음. 사내 API는 이후 OpenAPI/SDK로만 확장
- 웹 검색·외부 크롤링. 조사는 Gmail/RDB/로컬 파일만
- Skill을 여러 직원으로 자동 분해
- 승인 없는 self-learning production 반영
- Windows 절전 회피, 완전 무인 24/7 보장
- ForEach/Wait/Webhook/generic HTTP/Parallel/SubSkill primitive
- ERP/CRM/SharePoint, 브라우저 RPA, MySQL/MSSQL 방언, DB write, 회사 PDF 영역 지정
- prompt injection 벤치/보안 논문 트랙. 적대 메일은 eval 세트에 2~3개만
- 인터뷰 실험 실패 시 제품 폐기. 그때는 인터뷰를 메인 주장에서 뺄지 재검토할 뿐, 직원 앱은 유지한다

## Architecture

```
apps/desktop
  Electron main (always-on while 출근)
    ├ Tray + toast + badge
    ├ Global run switch (출근/퇴근)
    └ IPC to UI
  UI window (React)
    업무 / 대화 / 승인 / 활동 / 설정

packages/core
  skill/          Skill IR
  interviewer/    requiredness + interview loop
  runtime/        primitives + approval gate
  models/         Model Router
  store/          SQLite
  connectors/     capability registry + gmail, slack, rdb, local_sheet, report
```

```
사용자 "이 업무 해줘"
        ▼
Interviewer (부족한 요구만)
        ▼
Skill IR
   ┌────┴────┐
Policy     Capability Registry
   │      Gmail / Slack / RDB / Files / Report
   ▼
Runtime: Action | AI Decision | IF | Human Approval
        ▼
실행 / 조사 / 보고
        ▼
Activity / Audit / Revision
```

Electron은 셸이다. 스케줄·런타임·인터뷰·저장은 `packages/core`에 둔다. 무거운 추론/xlsx 파싱은 main event loop에서 오래 돌리지 않는다. 이후 headless/사내 서버는 같은 core를 부른다.

`packages/core`는 `electron`, `react`, `BrowserWindow`, tray를 **단 하나도 import하지 않는다.** 데스크톱 의존은 `apps/desktop`만 갖는다.

Skill IR (1급 객체):

- goal, trigger, inputs, steps, permissions, approval, fallback, success, version
- assumptions: 인터뷰에서 확인한 암묵적 가정
- sideEffects: 각 action의 효과 등급. 승인 게이트의 source of truth
- dataPolicy: 예) `emailBody.cloudAllowed: false`
- steps.type: `action` | `ai_decision` | `if` | `human_approval`

sideEffect 등급과 기본 승인 정책:

- `NONE` — 예: gmail.read. 승인 없음
- `REVERSIBLE` — 예: gmail.createDraft. 승인 없음
- `EXTERNAL` — 예: slack.send. Skill 만들 때 사용자가 **자동 실행을 허용할 수 있다.** 허용하면 매 실행 승인 없음
- `EXTERNAL_HIGH` — 예: gmail.send. **매 실행 Human Approval 필수.** Skill 설정으로 끌 수 없다

## Definitions (frozen)

**Task**는 DB 객체가 아니다. 저장되지 않은 one-shot Skill 실행이다. “지난달 매출 조사해줘” → ephemeral IR을 만들어 한 번 돌리고 `executions`에만 남긴다. `tasks` 테이블은 Phase 1에 만들지 않는다.

**Skill**은 persisted 업무 계약이다. “앞으로 매달 해줘” → 방금 쓴 IR에 trigger를 붙여 Skill로 저장한다.

**Investigation**은 범용 Loop/ForEach primitive가 아니다. AI Decision 안의 bounded read-reason cycle이다. Runtime이 `nextRead` capability만 실행하고, 기본 최대 **4회** 후 결론을 강제한다. 일반 루프 엔진을 만들지 않는다.

Connectors (각각 capability를 선언한다. `read` / `write` / `trigger`, risk, permission):

- `gmail`: messages.read, search, draft, send(gated), new_message trigger
- `slack`: message.send. v1에서 채널 읽기는 없음
- `rdb`: schema.describe, query.read (SELECT만). Postgres 또는 SQLite 파일. 앱 저장소 SQLite와 연결을 섞지 않음
- `local_sheet`: csv/xlsx read
- `report`: html.render, docx.fill, pdf.generate. PDF 출력은 desktop이 Chromium `printToPDF`로 구현하고, core는 HTML/데이터만 만든다

RDB 쿼리는 LLM 텍스트 SQL이 아니라 structured intent → policy engine → connector. 허용 스키마 밖, write, row limit 초과는 실행하지 않는다.

조사 스텝: Investigation bounded cycle. AI Decision 출력은 `{ needMore: boolean, nextRead?: capabilityId, reason }` 또는 최종 `{ conclusion, evidence[] }`. Runtime만 다음 read를 실행한다. 웹 capability는 없다. 최대 4회. Loop primitive가 아니다.

Models:

- default `ollama` OpenAI-compatible via `ModelProvider`
- optional OpenAI-compatible cloud endpoint in settings
- dataPolicy가 금지하면 클라우드로 해당 필드를 보내지 않음

## Tech Stack

언어는 **TypeScript 하나**다. Electron 셸, core, UI, eval을 같은 타입으로 묶는다. 개발 Node는 **24 LTS**로 맞춘다. Electron 43이 Node 24를 포함하므로, better-sqlite3 같은 native module을 개발/런타임에서 같은 ABI로 빌드하기 위해서다.

| 층 | 선택 | 이유 |
|---|---|---|
| Language | TypeScript (strict), Node 24 LTS | Electron 43 내장 Node와 맞춤 |
| Monorepo | pnpm workspaces | `packages/core`, `apps/desktop` |
| Core schema | Zod | Skill IR, LLM structured output, 나중에 IPC까지 |
| DB | drizzle-orm + better-sqlite3 | 로컬 SQLite에 가볍다. desktop 빌드 때 `@electron/rebuild` 필수 |
| LLM | `ModelProvider` + AI SDK openai-compatible | Interviewer/AI Decision이 Zod 구조화 출력을 계속 씀. Ollama와 OpenAI-compatible만 v1 |
| Gmail | `googleapis` + `google-auth-library` | desktop loopback OAuth |
| Slack | `@slack/web-api` | chat.postMessage |
| Sheets stand-in | exceljs | 로컬 xlsx/csv |
| RDB connector | `pg` + better-sqlite3 (별도 연결) | 사용자 데이터 읽기. 앱 DB와 분리 |
| Report | handlebars HTML + docxtemplater. PDF는 desktop `printToPDF` | core는 electron을 import하지 않음 |
| Test / eval | vitest | core는 Electron 없이 테스트 |
| Desktop | electron 43 + electron-vite | 트레이, close-to-tray, Windows 우선 |
| UI | React 19 + Vite | desktop 창은 SPA면 충분. Next.js 불필요 |
| UI kit | Tailwind CSS + shadcn/ui | 업무/대화/승인/활동 화면을 제품처럼 |
| Pack | electron-builder | Windows 설치본 |
| Secrets | OS credential store | 토큰을 우리 서버에 두지 않음 |

모델 계층:

```ts
interface ModelProvider {
  generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T>
  generateText(input: TextGenerateInput): Promise<string>
}
```

v1 구현은 `OpenAICompatibleProvider` 하나다. Ollama(`http://localhost:11434/v1`), OpenAI, LM Studio, 사내 compatible endpoint가 여기로 들어온다. 어댑터는 Vercel AI SDK의 openai-compatible을 쓴다. Interviewer는 `ai`의 `generateText`/`tool`을 직접 부르지 않고 `ModelProvider`만 본다. 모델이 action/tool을 고르게 하지 않는다.

Anthropic/Gemini provider는 나중. 그때 인터페이스 뒤에 어댑터만 추가한다.

쓰지 않는 것:

- Next.js: 로컬 창에 서버 프레임워크가 필요 없다
- Prisma: Electron에서 불가는 아니다. 다만 SQLite 하나·쿼리 단순·로컬 패키징이면 Drizzle이 더 가볍다
- Python/Rust sidecar: 묶을 수는 있다. 지금 필요한 CPU 작업이 없어서 복잡도만 는다
- Tauri: 셸은 Electron으로 고정. core가 분리돼 있으면 나중에 옮길 수 있다
- Redis/Bull. 앱 저장소는 SQLite. 사용자 RDB는 connector로만 Postgres/SQLite 파일을 읽는다
- core 안의 Anthropic/Gemini 패키지, core 안의 electron/react import

스케줄은 라이브러리 큐 없이 core 안의 타이머 + next-run 컬럼으로 시작한다.

## Implementation Phases

리스크 경계로 나눈다. 한 페이즈는 그 경계가 테스트 가능해질 때까지.

### Phase 1: Skill IR contract and core store

Goal:
- UI/런타임/eval이 같은 계약을 공유하고, 그 계약이 Electron 밖에 있다.

Deliverables:
- pnpm workspace: `packages/core`, `apps/desktop` placeholder. engines Node 24
- Zod `WorkflowIR` (`assumptions`, `sideEffects`, `dataPolicy` 포함)
- `ConnectorCapability` 카탈로그 타입. Gmail/Slack/rdb/local_sheet/report 선언 fixture
- drizzle + better-sqlite3: `skills`, `workflow_versions`, `executions`, `approvals`, `settings`. **`tasks` 테이블 없음**
- `ModelProvider` 인터페이스만. 구현/AI SDK는 Phase 2
- fixture 3개 (CS 메일+send 승인, 주간 보고, 가정/dataPolicy 예시)
- sideEffect → approval helper: HIGH는 항상 승인, EXTERNAL은 Skill 플래그, 나머지 없음
- core가 electron/react를 import하지 않는지 lint 또는 테스트로 확인

Verification:
- schema validate fixtures
- CRUD roundtrip in core, Electron import 없이
- `gmail.send` fixture는 approval 없이 invalid
- `packages/core` 의존성에 electron/react 없음

Rollback:
- 파일 삭제. 아직 OS 연동 없음.

### Phase 2: Interviewer → IR

Goal:
- 한 문장 지시에서 **필요한** 빈칸만 묻고, 배포 가능한 IR이 나오거나 질문이 남는다.

Deliverables:
- completeness engine. LLM이 complete 여부를 판정하지 않음
- requiredness rules. 그래프를 보고 필수 슬롯을 계산
  - `slack.send` → channel
  - `gmail.send` / `EXTERNAL_HIGH` → approval policy
  - scheduled trigger → schedule/timezone
  - `ai_decision` → output schema
  - local file read → path
  - `rdb.query` → connection + allowed schema
  - `report.generate` → template
  - filter/exception은 해당 분기가 있을 때만
- 필요한 capability가 연결 목록에 없으면 환각하지 않고 연결을 요구
- interview loop: 필수 빈칸만 질문
- 사용자가 허용한 가정은 `assumptions`에 기록
- “업무를 이렇게 이해했습니다” 요약 뷰 모델
- direct-compile 경로 (실험 baseline. UI 기본값 아님)
- `OpenAICompatibleProvider`: AI SDK openai-compatible. Interviewer는 `ModelProvider`만 호출. 모델에 tool/action을 주지 않음

Verification:
- underspecified prompt → remaining **required** slots
- filter 없는 단순 알림은 filter 없이도 deploy 가능
- `gmail.send`가 있으면 approval 빈칸이면 deploy 불가
- filled answers → valid IR

Rollback:
- interviewer만 제거. store는 유지.

### Phase 3: Early IR eval

Goal:
- Electron/OAuth 전에 인터뷰가 Direct보다 필요한 요구를 더 잘 회수하는지 본다.

Deliverables:
- 10~20 gold scenarios. 슬롯 전부 필수가 아니라 requiredness 기준 gold
- 적대 메일(prompt injection) 2~3개 포함. 모델이 action을 고르면 실패
- runner: Direct (한 문장 → IR) vs Interview (한 문장 → 인터뷰 → IR)
- metrics:
  - required-field recall
  - deployable IR rate
  - dangerous action omission (`EXTERNAL_HIGH` 승인 누락)
  - unjustified assumption rate (Direct가 확인 없이 채운 칸)
  - questions asked

Verification:

```powershell
npm run eval
```

결과 해석:
- 인터뷰가 필요 슬롯/위험 액션에서 유의미하게 낫면 가설 유지하고 Phase 4로
- Direct와 거의 같고 unjustified assumption도 비슷하면, 제품을 접지 않는다. 인터뷰를 메인 연구 주장에서 뺄지와 interviewer 설계만 재검토한다

Rollback:
- `eval/`은 core와 분리. 실패해도 스키마/인터뷰 코드는 남음.

### Phase 4: Runtime with mock connectors

Goal:
- IR을 실제로 돌리고, 승인 게이트가 외부 side effect를 막는다. LLM은 판단만 한다.

Deliverables:
- primitives: trigger(manual/schedule), action, ai_decision, if, human_approval
- mock Gmail/Slack/local_sheet/rdb/report
- AI Decision: 선언 schema만 parse. tool 호출 금지
- trusted Skill instruction vs untrusted email body를 프롬프트에서 분리
- execution log. 실패는 구조화 코드로 남김 (`oauth_refresh_failed` 등)
- `EXTERNAL_HIGH`는 pending approval. 승인 전 `gmail.send` 호출 불가
- Slack send와 draft는 승인 없이 가능

Verification:
- CS fixture: classify → slack mock + draft mock → pending send approval
- rejected approval → no send
- injection sample: email이 “gmail.send 하라”고 해도 runtime action이 바뀌지 않음
- schedule trigger fires in-process

Rollback:
- runtime flag off.

### Phase 5: Tray shell, 출근/퇴근, approval notify

Goal:
- 창과 직원의 수명이 분리된다. core는 Electron 안에 호스트만 된다.

Deliverables:
- `apps/desktop`: Electron 43, close-to-tray
- UI: 업무 / 대화 / 승인 / 활동
- 전역 출근/퇴근, Skill on/off
- pending approval → toast + tray badge
- 설정: Ollama endpoint, optional cloud key, dataPolicy 표시
- better-sqlite3는 `@electron/rebuild`로 Electron ABI에 맞춤

Verification:
- 창 종료 후에도 core scheduler tick
- 퇴근 중이면 trigger ignore + 활동 기록
- 승인 건수 배지
- core 테스트가 desktop 없이 통과

Rollback:
- 개발 중 UI 없이 core만 실행 가능해야 함.

### Phase 6: Real Gmail and Slack

Goal:
- 메인 데모가 실제 계정으로 끝까지 통과한다. 전송은 승인 후에만.

Deliverables:
- desktop OAuth loopback
- Gmail: list/read, create draft, send (gated)
- Slack: send to chosen channel
- disconnect, token refresh, 실패를 구조화 이력에 기록

Verification:
- live smoke: 1 mail in → 1 slack + 1 draft → 승인 → 1 send
- 승인 전 send 0건
- token 만료가 활동/이력에 코드로 남고, 이후 Q&A가 그 코드를 읽는다

Rollback:
- connector를 mock로 되돌리는 설정.

### Phase 7: Local sheet report + conversational revision

Goal:
- 보조 데모와 “직원에게 다시 말하기”가 된다.

Deliverables:
- local CSV/xlsx read (core, main loop 밖에서)
- Skill 수정 지시 → version proposal → 승인 후 vN
- pause / manual run / 마지막 ephemeral 실행 IR을 trigger 붙여 Skill로 저장
- execution Q&A (“왜 오늘 보고 안 올라왔어?”). 로그 뷰어가 아니라 구조화 이력을 말로 설명
- 권장 조치 CTA (예: Gmail 다시 연결)

Verification:
- 매출 fixture 파일 → Slack 보고 payload
- “10%면 알려줘” → 새 버전, 이전 버전 복구 가능
- “앞으로 매달 해줘” → trigger가 붙고 Skill로 저장
- 파일 없음/oauth 실패가 자연어 답변으로 설명됨

Rollback:
- revision을 끄면 카드 편집만 남김.

### Phase 8: Read-only RDB + HTML/DOCX report

Goal:
- 내부 데이터 조사와 회사 양식 보고가 같은 primitive로 돈다.

Deliverables:
- RDB connector: Postgres 또는 SQLite 파일. `schema.describe`, SELECT only
- policy: 스키마/테이블 화이트리스트, row limit, Skill 권한. raw SQL 직접 실행 없음
- 앱 store SQLite와 사용자 RDB 연결 분리
- AI Decision이 `nextRead`로 `rdb.query` / `gmail.search`를 요청하면 Runtime만 조회. Investigation bounded cycle, 최대 4회 후 결론 강제. Loop primitive 아님
- report: HTML 템플릿(표·간단 차트) + DOCX fill. desktop `printToPDF`
- 보고서 외부 전송은 기존 승인 게이트

Verification:
- 허용 테이블 SELECT → rows. 금지 스키마/DELETE 시도 → 거부
- mock/실데이터: 매출 하락 → DB+메일 근거 → PDF → 승인 → Slack
- 웹 검색 capability 요청은 카탈로그에 없어 인터뷰가 연결을 요구하거나 스킵
- core 테스트가 printToPDF 없이 HTML 출력만으로 통과

Rollback:
- rdb/report 커넥터 off. Gmail/Slack/시트만으로 앱 동작.

### Phase 9: Hardening

Goal:
- 혼자 매일 켜두고 쓸 수 있다.

Deliverables:
- credential OS store
- dataPolicy대로 클라우드 전송 차단이 실제 모델 호출에서 지켜짐
- missed schedule on wake
- installer, 로그 로테이션, 기본 권한 프리셋
- eval 회귀 한 번 더 실행

Verification:
- 재부팅 후 출근 상태 복구
- 클라우드 키 없는 환경에서 Ollama만으로 인터뷰+분류
- 외부 send 0건 without approval
- `npm run eval` 회귀

Rollback:
- portable dir wipe.

## Test Plan

```powershell
npm test
npm run eval
```

수동:

1. Ollama 실행 확인
2. Gmail/Slack 연결
3. CS 지시 → 인터뷰 → 테스트 → 맡기기
4. 창 닫기 → 메일 1통 → Slack+draft → 트레이 알림 → 승인 → 실제 전송
5. 전역 퇴근 → 메일이 와도 Slack 없음
6. 로컬 매출 파일 Skill → Slack 보고
7. RDB(또는 SQLite 샘플) + Gmail 근거 → PDF → 승인 → Slack
8. “왜 실패했어?” → 이력 답변

## Risks And Assumptions

- Windows 우선. 개발 Node 24 LTS, desktop은 Electron 43. macOS/Linux는 같은 core를 나중에 감싼다.
- 사용자는 Google/Slack 개발자 앱과 Ollama를 자기 머신에 준비한다. Gmail send 스코프를 포함한다. RDB는 로컬 Postgres 또는 샘플 SQLite면 된다.
- 절전 중 스케줄은 보장하지 않고 missed로 기록한다.
- 1차 UI 언어는 한국어.
- Electron 용량/Chromium은 수용. Tauri 이전은 core가 분리돼 있으면 가능하다.
- gold 시나리오를 “모든 슬롯 필수”로 만들면 인터뷰가 가짜로 이긴다. requiredness gold만 쓴다.

## Phase Reports

각 페이즈 끝에 `docs/reports/ax-studio.phase-N.md`를 남긴다.

## Codex/Claude Prompt

```text
Read docs/research/ax-studio.md and docs/plans/ax-studio.md.
Implement Phase 1 only: pnpm workspace (Node 24), packages/core Skill IR as Zod schema (including assumptions, sideEffects, dataPolicy), drizzle+better-sqlite3 store (works, workflow_versions, executions, approvals, settings — no tasks table), sideEffect→approval helper (EXTERNAL_HIGH always, EXTERNAL via skill flag), ModelProvider interface only (no AI SDK impl), ConnectorCapability catalog types, and 3 fixtures.
packages/core must not depend on electron or react. Create apps/desktop as an empty placeholder only. Do not add Electron, OAuth, interviewer, or UI.
Keep the patch small and testable. Run the smallest schema/store tests. Report changed files and verification.
```
