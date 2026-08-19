# AX Studio Research And Decision Log

Status: Frozen after interview round 3, amended 2026-08-19. **Product/architecture/v1 scope frozen.** New ideas → `docs/future.md`.  
Scale: Large  
Date: 2026-08-19

## Problem

비개발자는 업무를 사람 직원에게 말하듯 지시할 수 있지만, 실행 가능한 자동화 명세(trigger, source, filter, action, exception, permission, approval)를 처음부터 완성하지 못한다. 기존 도구는 그 지시를 workflow/agent 빌더 문제로 바꿔 버린다.

## Finished Target

혼자 쓰는 로컬 AX 제품. 사용자는 자연어로 업무를 지시하고, 시스템이 부족한 요구를 인터뷰로 채운 뒤 Skill로 저장·백그라운드 실행한다. 창을 닫아도 직원은 퇴근 스위치를 끄기 전까지 일한다.

## Decision: First-party connectors vs SaaS zoo

Context:
- 최종 비전 초안에 Outlook, Teams, Drive, Sheets, Salesforce, HubSpot, Jira, ERP, GitHub, 웹 검색까지 나열되면 커넥터 회사가 된다.
- 사용자는 조사는 내부(RDB/Gmail/Slack/보고)로 한정했고, 외부 SaaS는 조정하라고 했다.

Options:
- A: 카테고리별 대표 SaaS를 전부 first-party로 약속
- B: Gmail + Slack만 외부 SaaS. 데이터는 RDB/로컬 파일. 보고는 자체 렌더러. 나머지는 SDK/OpenAPI
- C: Gmail만 하고 Slack도 제네릭 웹훅

Decision:
- B

Consequences:
- 1급 외부 SaaS는 Gmail과 Slack뿐이다.
- Sheets/Drive API를 쓰지 않는다. 표는 CSV/xlsx, 문서는 로컬 DOCX/PDF.
- 사내 ERP/CRM은 내장하지 않는다. DB에 있으면 RDB, API면 이후 OpenAPI capability.
- 웹 검색은 비전에 넣지 않는다.
- Connector를 늘리는 확장이 아니라 capability를 등록하는 확장이다.

## Decision: Task, Investigation bound, EXTERNAL policy

Context:
- freeze 직전에 객체/루프/승인 기본값이 한 줄씩 비어 있었다.

Decision:
- Task는 테이블이 아니다. ephemeral one-shot Skill 실행. 기록은 `executions`만.
- Investigation은 Loop primitive가 아니다. AI Decision bounded read-reason, 최대 4회.
- EXTERNAL은 Skill 생성 시 자동 허용 가능. EXTERNAL_HIGH(gmail.send)는 매 실행 승인 필수.

Consequences:
- Phase 1에 `tasks` 없음.
- 일반 루프 엔진을 만들지 않음.
- Slack 자동 vs 메일 결재의 이유가 정책으로 설명된다.

## Decision: Product metaphor

Context:
- n8n/Zapier/Lindy는 자연어로 workflow/agent를 만드는 쪽으로 이동 중.
- 이 제품의 차별점은 빌더가 아니라 업무 지시와 요구 완전성이다.

Options:
- A: 자동화 빌더 (자연어 → n8n/workflow)
- B: AI 직원에게 업무를 지시·가르치는 운영 도구

Decision:
- B

Consequences:
- UI에 캔버스/노드를 기본 화면으로 두지 않는다.
- Skill이 workflow alias가 아니라 업무 계약이다.
- 화면 언어는 업무 / 대화 / 승인 / 활동. Workflow, Executions, Credentials를 노출하지 않는다.

## Decision: Runtime host

Context:
- n8n을 붙이면 Skill이 외부 workflow ID가 되기 쉽다.
- n8n을 재구현하면 학기/에너지가 인프라에 잠긴다.

Options:
- A: n8n compile/export가 메인
- B: 최소 primitive만 가진 자체 runtime
- C: OpenClaw/Hermes에 Skill을 위임

Decision:
- B. n8n은 필수가 아니다. 대체재도 아니다.

Consequences:
- v1 primitive: Trigger, Action, AI Decision, IF, Human Approval.
- ForEach/Wait/HTTP/Calendar는 1차 완성선 밖.
- LLM은 판단만 하고 Runtime이 행동한다. 모델 output은 선언된 schema만 허용한다.
- 나중에 같은 core를 서버에 올리면 사내 AX가 된다. 그건 배포 모드이지 지금 기능이 아니다.

## Decision: Deployment

Context:
- SaaS면 Gmail/Slack 토큰과 스케줄러를 운영자가 책임진다.
- 로컬이면 토큰이 사용자 머신에 남는다.
- 노트북을 끄면 로컬 실행은 멈춘다. 창을 닫는 것과 프로세스를 끄는 것은 다르다.

Options:
- A: SaaS
- B: 로컬 웹앱만 (창 닫으면 실행 중단)
- C: 로컬 트레이 앱 (창 닫아도 런타임 유지, 출근/퇴근 스위치)
- D: 처음부터 사내 멀티유저

Decision:
- C for product. D는 다음 층.

Consequences:
- 실행 엔진은 renderer/webview에 두면 안 된다.
- 전역 출근/퇴근 + Skill별 활성/비활성.
- 사내 버전은 같은 core를 서버에 올리는 것. 계정 모델은 지금 없음.

## Decision: Package split

Context:
- 런타임을 Electron main에 직접 붙이면 headless/사내 배포가 어렵다.
- 추론/xlsx를 main event loop에서 돌리면 트레이/알림이 멈춘다.

Options:
- A: 모든 로직을 Electron 앱 안에
- B: `packages/core` + `apps/desktop` 셸

Decision:
- B. Phase 1부터 분리한다.

Consequences:
- Electron은 tray, window, OS notify, OAuth loopback 호스트.
- 스케줄, IR, interviewer, runtime, store는 core.

## Decision: v1 success and evaluation

Context:
- 인터뷰 효과 측정이 Electron/OAuth보다 싼 리스크 경계다.
- 모든 슬롯을 필수로 두면 인터뷰가 가짜로 이긴다.
- 제품 1순위는 쓰는 직원 앱이다. 실험 실패가 제품 폐기를 의미하지 않는다.

Options:
- A: 시연만
- B: 시연 + 10~20개 시나리오 비교실험
- C: 논문급 50개 + 사람 실험

Decision:
- B. 실험은 Interviewer 직후, Runtime/Electron 전에 한다.

Consequences:
- Gold는 requiredness 기준. 전 슬롯 필수가 아니다.
- Baseline: 한 문장 → IR.
- Proposed: 한 문장 → adaptive interview → IR.
- 지표: required-field recall, deployable IR rate, dangerous action omission, unjustified assumption rate, questions asked.
- 적대 메일 2~3개는 eval에만 넣는다. 별도 보안 연구 트랙은 없다.
- 인터뷰가 Direct와 비슷하면 주제를 접지 않는다. 인터뷰를 메인 주장에서 뺄지와 interviewer 설계만 재검토한다.

## Decision: Completeness / requiredness

Context:
- LLM에게 “질문 다 했니?”를 맡기면 테스트 불가능하다.
- 모든 업무가 filter를 필요로 하지는 않는다.

Options:
- A: 고정 슬롯을 전부 채워야 deploy
- B: IR 그래프를 보고 필수 슬롯만 계산

Decision:
- B. 체크리스트 엔진이 source of truth다.

Consequences:
- 예: slack.send → channel, gmail.send → approval, schedule trigger → timezone, ai_decision → output schema.
- filter/exception은 해당 분기가 있을 때만 필수.

## Decision: Connectors and Gmail send

Context:
- 연동을 늘리면 인테그레이션 프로젝트가 된다.
- draft만 있으면 승인함이 “초안 확인”이 되고, send가 있어야 “이 메일 보낼까요?”가 된다.

Options:
- A: Gmail+Slack 실제, Sheets 로컬. v1은 draft까지만
- B: 같고, v1에 Gmail send를 넣되 Human Approval 뒤에서만
- C: 세 개 전부 실제 OAuth

Decision:
- B

Consequences:
- Google Cloud OAuth에 send 스코프를 포함한다.
- 메인 플로우: 수신 → 분류 → Slack + draft 자동 → 전송만 승인.
- Sheets 역할은 CSV/xlsx. HTTP 범용 커넥터는 1차에 없음.

## Decision: Models

Context:
- 운영 클라우드 키가 없다.
- 로컬 우선은 “우리 서버 없음”이지 모델 강제 로컬만은 아니다.

Options:
- A: 클라우드 API 키만
- B: Ollama만
- C: 둘 다. 로컬이 기본, 클라우드 키는 옵션

Decision:
- C. 기본은 Ollama(`localhost:11434`). 클라우드 키는 있으면 사용.

Consequences:
- Model Router가 Skill/설정에서 endpoint를 고른다.
- `dataPolicy`가 금지한 필드는 클라우드로 보내지 않는다.
- 키 없으면 클라우드 경로는 비활성.

## Decision: Approval

Context:
- 외부 메일 발송은 사람 승인 없이 가면 안 된다.
- Slack interactive approval은 별도 권한/실패 모드가 생긴다.
- 창이 닫혀 있어도 직원은 일하고 있으므로 노크가 필요하다.

Options:
- A: 앱 안 승인함 + 트레이 알림/배지
- B: Slack에서 승인
- C: 창을 열 때까지 조용히 대기만

Decision:
- A

Consequences:
- 승인 여부는 LLM이 아니라 `sideEffects`로 계산한다. `EXTERNAL_HIGH`만 필수 결재.
- Slack notify와 Gmail draft는 자동. Gmail send는 승인 후.
- Human Approval은 runtime primitive다.

## Decision: Skill IR extra fields

Context:
- 권한/승인/모델 라우팅을 인터뷰 문장에만 두면 테스트가 안 된다.

Options:
- A: goal/trigger/steps/permissions/approval만
- B: + assumptions, sideEffects, dataPolicy

Decision:
- B. Phase 1부터 스키마에 넣는다.

Consequences:
- assumptions: “발신자 도메인이 거래처 ID다”처럼 확인된 암묵 가정.
- sideEffects: NONE / REVERSIBLE / EXTERNAL / EXTERNAL_HIGH.
- dataPolicy: 예) emailBody.cloudAllowed = false.

## Decision: Untrusted input

Context:
- 고객 메일은 prompt injection 벡터다.

Options:
- A: 메일 본문을 Skill 지시와 같은 프롬프트 권한으로 넣음
- B: Skill instruction = trusted, email body = untrusted. 모델은 schema만 출력

Decision:
- B. 별도 보안 실험 트랙은 만들지 않는다.

Consequences:
- AI Decision이 tool name을 선택하지 못한다.
- eval에 적대 메일 2~3개.

## Decision: App shell

Context:
- 로컬 웹앱만이면 사용자가 터미널과 브라우저를 관리하게 된다.
- 백그라운드 UX는 OS 트레이가 자연스럽다.

Options:
- A: daemon + 브라우저
- B: 트레이 데스크톱 앱
- C: Docker가 런타임

Decision:
- B. Windows 우선 Electron 셸. 창 닫기 ≠ 종료. 로직은 core.

Consequences:
- Electron을 고른 이유: OAuth loopback, 트레이, 알림을 TypeScript 셸로 묶기 쉽다.
- 나중에 사내 배포는 core를 headless로 띄운다.

## Decision: First completion line

Context:
- “최대한”은 데모를 얇게 자르지 말라는 뜻이다.
- 사내 멀티유저/커넥터 확장/Skill 분해를 같이 하면 계정과 연동에 잠긴다.

Options:
- A: 1인 로컬 완성품
- B: A + 사내 계정
- C: A + 커넥터 확장 + Skill 자동 분해 + n8n export

Decision:
- A

Consequences:
- 1차 완성: 지시, 인터뷰, Skill, 백그라운드 실행, 승인함, 이력, 출근/퇴근, Gmail+Slack+로컬시트, 초기 IR eval.
- “왜 안 했어?”는 실행 이력 이후(Phase 7). 그 전에 구조화 실패 코드만 남긴다.
- 명시적 나중: 멀티유저, SSO, n8n, OpenClaw, 커넥터 마켓, Skill 팀 분해.

## Architecture Fit

```
apps/desktop          packages/core
 Electron shell   →    skill / interviewer / runtime
 tray, IPC, OAuth      models / store / connectors
 UI: 업무 대화 승인 활동
```

핵심 객체는 Skill IR이다. UI와 커넥터는 IR의 편집기/실행기다.

## Integration Boundaries

- Gmail: read, compose/draft, send. send는 승인 후에만.
- Slack: `chat:write` to a selected channel. 승인 채널이 아님.
- Local sheet: 파일 picker. Google Sheets API 없음.
- Ollama: OpenAI-compatible local HTTP. 앱이 Ollama를 설치해주지는 않음.

## Data / Security / Privacy

- 1인, 로그인 없음. 데이터는 로컬 SQLite + OS credential store.
- OAuth 토큰을 우리 서버에 올리지 않음. 서버가 없다.
- `gmail.send`는 권한 프리셋이 아니라 runtime 게이트로 막는다.
- 메일 본문은 untrusted. dataPolicy 기본은 클라우드 금지.
- Skill 변경은 즉시 덮어쓰지 않고 버전 proposal → 승인.

## Rollout / Rollback

- 설치: Windows 데스크톱 빌드. 개발 중에는 `electron` dev.
- Rollback: Skill 버전 되돌리기, 전역 퇴근, 커넥터 disconnect.
- 사내 서버 배포는 1차 롤아웃 아님.

## Test / Verification

- IR 스키마 fixture. send 없는 approval skip, send 있는 approval required.
- Interview completeness: 필수 빈칸이 남은 채 deploy 불가.
- Early eval: Direct vs Interview, Electron 이전.
- Runtime: mock 메일 → 분류 → slack + draft → send gate. injection이 action을 바꾸지 못함.
- Live smoke: 실제 메일 1통, Slack 1채널, 승인 후 실제 send 1건.

## Operational Risk

- Ollama 미실행, Google OAuth consent(send 포함), Slack 워크스페이스 권한.
- 백그라운드 앱이 메일/슬랙에 접근하므로 전역 퇴근과 실행 이력이 필수.
- Windows 절전 시 스케줄 스킵 → 이력에 “missed”. 절전 회피는 1차 범위 밖.
- gold를 전 슬롯 필수로 만들면 eval이 인터뷰에 유리하게 왜곡된다.
