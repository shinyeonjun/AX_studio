# AX Studio North Star — Research And Decision Log

Status: **Active** after interview rounds 1–6, amended 2026-08-23 (architecture review). This document supersedes the *product vision* in `docs/research/ax-studio.md` and `docs/plans/ax-studio.md`. Those files remain the v1 freeze / historical record. Current implemented UX is described in `docs/plans/ax-workspace-migration.md`.

Scale: Large  
Date: 2026-08-23

## Problem

현재 구현은 “읽기 채팅 + `/once`·`/workflow`로 그래프를 짜는 슬라이스”다. 사용자가 원하는 제품은 그 슬라이스가 아니라, GPT/Claude 앱처럼 사는 로컬 업무 환경이다. 연결한 모든 것이 도구가 되고, 평챗은 지식 비서, `/`는 n8n식 워크플로 작성, 라우터는 Codex처럼 맞는 capability/skill/저장 업무를 고른다.

v1 freeze(`docs/research/ax-studio.md`)는 이 방향과 충돌하는 결정이 있다. 특히 “AI 직원 / 노드를 보여 주지 않음 / Slack 보내기 전용 / HTTP·webhook·MCP는 밖”이다. 이번 인터뷰가 그 비전을 교체한다. v1에서 유지할 DNA(로컬 런타임, 채팅이 쓰기를 직접 하지 않음, 코드가 스키마·승인 소유)는 재확인했다.

## Finished Target

혼자 쓰는 로컬 AX 앱. 겉은 GPT/Claude 앱. 속은 연결 허브 + 검색 가능한 지식 + 도구 라우터 + 워크플로 런타임.

사용자는 연결하고, 평소엔 물어보고, 프로그램을 짜고 싶으면 `/once` 또는 `/workflow`라고 말한다. 에이전트는 연결·스킬·저장 업무를 보고 맞는 것을 고른다. 새 그래프는 미리보기로 검수하고, 쓰기는 런타임과 승인 게이트를 탄다.

한 줄:

> 연결한 것을 도구와 지식으로 두고, ChatGPT처럼 물어보고, `/`로 n8n처럼 워크플로를 짜며, Codex처럼 맞는 도구를 고르는 로컬 앱.

## Ambiguity

Interview start: ~60% (비전 충돌).  
After rounds 1–6: ~10%.  
After architecture review: remaining open items are embedding model choice, tunnel UX detail, OpenAPI auth scheme set — phase-level, not vision-level.

---

## Decision: Product metaphor

Context:
- v1 freeze는 “AI 직원에게 업무를 맡김”. UI에 캔버스/노드를 집으로 두지 않음.
- 사용자는 GPT/Claude 앱 UX + n8n/Zapier 노드 프로그래밍 + Codex 라우팅을 원함.

Options:
- A: 겉은 GPT/Claude 앱. 속은 AX 런타임. 채팅이 집. 노드 그래프는 결과물/검수 화면
- B: AI 직원 메타포 유지. 워크플로/노드를 기본 화면·용어로 쓰지 않음
- C: n8n 빌더가 집. 채팅은 그래프 입력창

Decision:
- A

Consequences:
- 홈 화면은 대화다. 설정에서 연결하고, 오른쪽은 그래프 미리보기일 수 있다.
- n8n급 드래그 캔버스 에디터는 최종 목표가 아니다.
- “직원”은 런타임 은유(창을 닫아도 일함)로 남을 수 있으나, 제품 정체감의 1순위는 챗 앱이다.

---

## Decision: Chat vs slash

Context:
- Codex는 평문만으로 도구를 고른다.
- 사용자는 `/`로 워크플로를 만든다고 했고, 평챗은 챗봇이길 원함.
- 현재 코드는 평챗 = 읽기 전용, `/once` = 즉시 실행 설계, `/workflow` = 저장형 설계.

Options:
- A: 평챗 = 지식·조회·분석. 새 워크플로 작성은 `/once`·`/workflow`만. 평챗은 `/`를 제안할 수 있으나 무작성하지 않음
- B: 평챗에서도 보내기·파일쓰기 가능. 반복만 `/workflow`
- C: 슬래시 없음. 앱이 조회/일회성/저장을 자동 판단

Decision:
- A

Consequences:
- “메일 보내줘” 평챗 → 답은 가능, 전송은 `/once` 또는 저장된 업무 실행을 안내.
- 라우터는 평챗에서 *읽기 도구*와 *이미 있는 업무 실행*을 고를 수 있다. *새 그래프 작성*은 `/` 없으면 하지 않는다.

---

## Decision: Running saved work from plain chat

Context:
- 작성과 실행을 같은 스위치로 묶으면 Codex 감각이 죽는다.
- 작성을 `/`에만 두면, “그거 다시 돌려”가 막힌다.

Options:
- A: 저장된 업무는 평챗에서 실행 가능. 새로 짜는 것만 `/`. 승인 정책은 그대로
- B: 실행도 슬래시 또는 업무 탭만. 평챗은 side effect 없음
- C: `/` 없이도 일회 실행 그래프를 만들어 돌릴 수 있음

Decision:
- A

Consequences:
- 평챗 도구 표면에 `workflow.run`(이미 저장된 id)이 올라갈 수 있다. `workflow.create`는 `/` 전용.
- `/once`는 “없는 일을 지금 짜서 한 번”이다. 있는 일을 다시 하는 것은 평챗.

---

## Decision: First-party connectors

Context:
- v1: 1급 SaaS는 Gmail+Slack. 데이터는 RDB/로컬 파일. HTTP·webhook은 밖.
- 사용자는 Gmail, Slack, 자기 DB, REST, webhook을 연결하고 전부 tool로 보고 싶음.
- SaaS 동물원(Notion, Jira, Outlook, Drive…)은 v1에서 이미 거절됨.

Options:
- A: 1급 = Gmail, Slack, 로컬 폴더/문서, RDB, HTTP(REST), Webhook. 나머지 = OpenAPI/MCP 등록. Notion/Jira/웹검색은 1급 아님
- B: v1 유지. DB/REST/Webhook은 북스타 문장에만
- C: Notion, Drive, Calendar, Jira도 1급

Decision:
- A

Consequences:
- 커넥터 회사를 만들지 않는다는 원칙은 유지한다. 늘어나는 것은 *등록 표면*(OpenAPI/MCP)이다.
- RDB·HTTP·Webhook은 catalog/module로 1급 구현한다. 지금은 RDB 읽기만 있고 webhook은 stub이다.
- 웹 검색, 브라우저 RPA, Outlook/Teams/Drive/Sheets API, Notion, Salesforce, Jira는 계속 비목표.

---

## Decision: Knowledge layer

Context:
- 사용자는 RAG, 지식그래프, 옵시디언 위키를 착안함.
- 별도 PKM 앱을 만들면 제품이 갈라진다.

Options:
- A: 연결 소스(Gmail/Slack/폴더/DB/HTTP GET)를 도구로 검색·요약. 필요하면 로컬 인덱스(RAG). 위키 앱·전체 KG 아님
- B: 옵시디언 vault가 1급 지식 공간
- C: 객체·관계 그래프가 평챗의 주 엔진

Decision:
- A

Consequences:
- 지식 = 연결된 capability의 조회 결과 + (선택) 로컬 임베딩 인덱스.
- 옵시디언 vault는 로컬 폴더 연결로 흡수 가능하다. 별도 위키 제품이 아니다.
- 지식그래프는 이후 실험. 최종 목표 완료 조건이 아니다.

---

## Decision: Slack as knowledge

Context:
- v1 Slack은 보내기(알림 채널) 전용.
- 평챗 지식에 Slack이 없으면 “연결한 모든 것”이 거짓이 된다.

Options:
- A: Slack 검색·읽기 + 보내기. 읽기는 평챗, 보내기는 `/` 또는 저장된 업무
- B: 보내기만 유지
- C: 읽기는 최종 목표 후순위

Decision:
- A

Consequences:
- Slack 채널/메시지 읽기 capability와 trigger(`slack.new-message` 등)가 1급 지식·트리거가 된다.
- 보내기는 쓰기. 승인 게이트 대상.

---

## Decision: RDB writes

Context:
- “자기 DB”는 쓰기까지 열어 달라는 말로 들릴 수 있음.
- DB write는 트랜잭션·권한·실수 비용이 크다.

Options:
- A: 최종 목표도 SELECT만. 변경은 REST/Webhook으로 해당 시스템 API
- B: INSERT/UPDATE/DELETE를 `/`+승인으로 연다
- C: 연결 설정에서 테이블별 write를 켠다

Decision:
- A

Consequences:
- `rdb.query.read` / schema describe만. `docs/future.md`의 DB write는 계속 밖.
- 운영 시스템이 쓰기를 받으려면 HTTP 커넥터로 API를 친다.

---

## Decision: HTTP and webhook direction

Context:
- REST와 webhook을 둘 다 1급으로 올렸다.
- 로컬 앱은 공인 inbound URL이 없다.

Options (direction):
- A: HTTP = 아웃바운드 REST. Webhook = 인바운드 트리거. 인증/헤더는 연결 설정
- B: 아웃바운드만
- C: 인바운드만, 임의 REST는 OpenAPI 이후

Decision:
- A (direction)

Options (local inbound):
- A: 앱이 localhost URL을 연다. 외부는 사용자가 터널(Cloudflare/ngrok 등)을 연결 설정에 붙임. AX가 릴레이 SaaS를 운영하지 않음
- B: AX 클라우드 릴레이가 공인 URL을 줌
- C: inbound는 Gateway/서버 배포 때 완성. 로컬은 설계·내부 테스트만

Decision:
- A (tunnel-optional)

Consequences:
- `http.request`는 1급 **tool**. method 기본 분류는 GET→`NONE`, 그 외→`EXTERNAL`이지만 **최종 승인은 catalog `sideEffect`가 소유**한다 (amendment).
- Webhook은 1급 **trigger**이지 일반 read/write tool이 아니다. 로컬 리스너 + optional tunnel URL 표시.
- AX는 중계 서버를 운영하지 않는다. NAT 환경은 사용자 터널 책임.

---

## Decision: Router surface (Codex-like)

Context:
- Codex 앱은 플러그인·MCP·skill을 보고 고른다.
- v1는 MCP를 런타임으로 쓰지 않기로 함. 그 결정은 *런타임 호스트*로는 유지.

Options:
- A: 라우터는 AX capability + skill + 저장 업무를 고른다. MCP/OpenAPI는 연결되면 같은 catalog에 올라와 동일하게 선택됨. MCP는 런타임이 아님
- B: MCP가 본체. Gmail/Slack도 MCP 서버
- C: 플러그인 스토어/마켓에서 켠 것만

Decision:
- A

Consequences:
- 단일 catalog가 **정규화된 tool 목록**의 진실 공급원이다. 호출은 Tool Invoker가 한다 (amendment).
- skill은 역할/도메인 지침이지 마켓 플러그인이 아니다.
- OpenAPI spec 또는 MCP server를 연결하면 capability가 catalog에 올라가고, 실행은 HTTP/MCP adapter를 탄다.
- MCP를 workflow 엔진으로 쓰지 않는다. n8n도 실행 엔진이 아니다. (v1 runtime 결정 유지)

---

## Decision: OpenAPI and MCP in the finished target

Context:
- 1급 여섯 갈래만으로도 제품은 성립해야 한다.
- “등등 연결”은 등록 표면 없이 공허하다.

Options:
- A: 최종 목표에 OpenAPI 연결 + MCP 서버 연결이 포함됨. 없어도 1급만으로 제품은 성립
- B: 최종 완성 조건에서 빼고 다음 확장으로 분리
- C: MCP가 있어야 최종 목표 달성. 1급도 MCP로 래핑

Decision:
- A

Consequences:
- 완료 조건에 “OpenAPI 하나, MCP 하나를 catalog에 올려 평챗/`/`에서 쓴다”가 들어간다.
- Gmail/Slack을 MCP로 재작성하지 않는다.

---

## Decision: Graph UI

Context:
- 사용자는 n8n식 노드 프로그래밍을 원함.
- 정체감 A는 채팅이 집.

Options:
- A: 오른쪽은 읽기 전용(또는 가벼운 슬롯 편집) 미리보기. 프로그래밍은 대화와 `/`. n8n급 캔버스 아님
- B: n8n급 캔버스가 최종 목표
- C: 그래프 UI 제거. 요약 카드만

Decision:
- A

Consequences:
- 현재 `WorkflowPreviewPanel` 방향과 맞다. 확장해도 슬롯 편집·가독성이지 프리폼 캔버스가 아니다.
- 사용자는 노드를 *본다*. *그리는* 기본 입력은 자연어다.

---

## Decision: Authoring loop after `/`

Context:
- v1/현재는 코드 소유 슬롯 질문 + AI draft patch가 섞여 있음.
- 사용자는 그래프를 먼저 보고 검수하는 쪽을 원함.

Options:
- A: `/`면 에이전트가 그래프를 먼저 짬. 미리보기+검수 카드. 대화로 수정. 질문은 연결 안 됨/승인/실행 차단 누락만
- B: 코드가 필수 빈칸을 하나씩 물음
- C: 한 방 그래프, 수락/거절만

Decision:
- A

Consequences:
- completeness 엔진은 *차단 조건* 판정기로 남는다. 질문 UX의 주인공이 아니다.
- 검수 카드에서 저장/실행. 자동으로 `workflow.json`을 덮지 않음 (현재 경계 유지).

---

## Decision: Slash vocabulary

Context:
- 커맨드가 늘면 GPT 앱이 아니라 CLI가 된다.

Options:
- A: 사용자 커맨드는 `/once`, `/workflow` 두 개. 실행은 평챗/업무 탭. 연결은 설정. 내부 skill은 `/` 목록이 아님
- B: `/run` `/connect` `/tools` `/search`까지
- C: `/`는 힌트일 뿐 (작성만 `/` 권장)

Decision:
- A

Consequences:
- `/` 메뉴는 두 명령 + 설명. Codex식 도구 선택은 슬래시 없이 라우터가 한다.

---

## Decision: Approval defaults

Context:
- v1: Gmail send는 EXTERNAL_HIGH, 매 실행 승인. Slack은 자동 가능.
- HTTP POST와 Slack send를 같은 쓰기 계급으로 볼지가 비어 있음.

Options:
- A: 외부로 나가는 쓰기(Gmail send, Slack send, HTTP POST 등)는 업무별 승인 게이트를 둘 수 있음. 기본은 send/POST 승인, 조회 자동. 사용자가 완화 가능
- B: Gmail send만 항상 승인. Slack/HTTP는 자동 가능
- C: 연결마다 사용자가 켜고, 앱 기본 정책 없음

Decision:
- A

Consequences:
- 승인 기본값 표가 있다. 업무 저장 시 게이트를 보여 주고 완화할 수 있다.
- 평챗에서 저장된 업무를 실행해도 같은 게이트를 탄다.
- 조회 도구(`sideEffect=NONE`)는 승인 없음. HTTP GET을 절대 규칙으로 쓰지 않는다.

---

## Decision: Data leaving the machine

Context:
- 평챗 RAG는 본문을 모델에 넣는다.
- 이미 클라우드 provider에 PDF 본문을 안 보내는 정책이 있다.

Options:
- A: 모델은 사용자가 고름(클라우드/로컬). 연결 데이터는 질의·검색 *결과*로만 해당 모델에 감. 본문 대량은 로컬 모델 또는 명시 허용. 임베딩 인덱스는 기본 로컬
- B: 본문은 클라우드에 안 감. 지식 채팅은 로컬 모델 필수
- C: GPT 앱처럼 클라우드 전송이 기본, 옵트아웃만

Decision:
- A

Consequences:
- provider + dataPolicy가 지식 경로에도 적용된다.
- 로컬 인덱스는 디스크에 남고, 클라우드 임베딩 API를 기본으로 쓰지 않는다.
- 사용자가 Claude/GPT를 골랐으면 검색 히트(bounded)는 그 모델로 갈 수 있다. 폴더 전체를 업로드하지 않는다.

---

## Review amendments (2026-08-23)

비전 인터뷰를 뒤집지 않는다. 구현 전에 흔들릴 경계를 닫는다.

### Decision: Catalog vs Invoker vs Runtime

Context:
- “MCP는 catalog 주입이지 런타임이 아니다”는 *workflow 엔진이 MCP가 아니다*는 뜻으로 맞다.
- 그대로 읽으면 MCP tool을 목록에만 넣고 호출 경로가 없어 Success Criteria 7이 불가능해진다.

Options:
- A: Catalog(계약) → Tool Invoker(호출) → first-party / OpenAPI HTTP / MCP client adapter. Runtime은 workflow 오케스트레이션·trigger·approval·로그
- B: MCP session이 곧 실행기
- C: catalog 메타데이터만 넣고 호출은 각 페이즈에서 즉흥 구현

Decision:
- A

Consequences:
- MCP client/session은 **adapter**다. catalog 항목의 `invoke` 경로다.
- Agent는 catalog id를 고른다. Invoker만 외부 프로토콜을 안다.
- Gmail/Slack을 MCP로 재작성하지 않는다. 그 connector는 first-party adapter.

### Decision: Glossary (normative)

Context:
- tool / connector / resource / trigger / skill / webhook이 문서에서 섞였다.

Decision:
- 아래 계약을 쓴다. 새 이름을 만들지 않고 기존 코드 용어에 맞춘다.

| 용어 | 뜻 |
|------|----|
| Connection | 인증·접속 정보 (OAuth, token, DSN, base URL, tunnel URL) |
| Connector | Gmail, Slack, RDB, HTTP 같은 연동 **구현** |
| Tool / Capability | `gmail.message.search`, `slack.message.send`처럼 호출 가능한 기능. catalog 단위 |
| Resource | 메일, 메시지, PDF, DB row 등 tool이 다루는 대상. `SourceRef`로 가리킴 |
| Trigger | 새 메일, 새 파일, inbound webhook처럼 **워크플로를 깨우는 사건** |
| Skill | AI에게 주는 지침 문서. 호출 가능한 tool이 아님 |
| Workflow | 여러 tool/trigger를 이은 설계도 (`workflow.json` / IR) |
| Run / Execution | 그 설계도의 **한 번** 실행. 로그·승인의 단위 |

Webhook은 기본이 **Trigger**다. `webhook.read`/`webhook.write`를 1급 지식 tool처럼 두지 않는다. 수신 payload는 그 Run의 Resource다.

### Decision: Workflow lifecycle vs Run lifecycle

Context:
- `/workflow`의 “저장·트리거”는 저장 즉시 스케줄/webhook이 켜지는지 모호했다.
- 피드백의 `draft→saved→enabled→running→completed`는 **문서 상태와 실행 상태를 한 줄에 섞는다.**

Decision:
- 두 생명주기를 분리한다. 이미 store에 `active` 플래그가 있다.

Workflow (설계 문서):

```text
draft → saved (disabled) → enabled | disabled
```

- `/workflow` 검수 후 **저장 = saved + disabled**. trigger는 아직 안 듣는다.
- 사용자가 활성화해야 schedule/webhook/gmail poll이 돈다.
- `/once`는 enabled workflow row를 만들지 않는다.

Run (실행 한 건):

```text
queued → running → completed | failed | pending_approval
```

- `/once`도 실행 당시 IR **snapshot**과 execution 로그를 남긴다. 재현·감사 단위다.
- `running`은 workflow row 상태가 아니라 run 상태다.

### Decision: sideEffect catalog owns approval

Context:
- “GET=read, POST=write”를 절대 규칙으로 두면 OpenAPI `GET /delete?id=` 같은 구멍이 생긴다.
- 코드는 이미 `NONE | REVERSIBLE | EXTERNAL | EXTERNAL_HIGH`를 쓴다. 새 enum을 만들지 않는다.

Decision:
- HTTP method는 **ingest 기본값**만 준다 (GET→`NONE`, 그 외→`EXTERNAL`).
- 최종 승인·평챗 허용 여부는 capability `sideEffect`다.
- `EXTERNAL_HIGH`는 항상 승인. `EXTERNAL`은 업무 게이트(기본 on, 완화 가능). `NONE`/`REVERSIBLE`은 조회·가역.
- OpenAPI/MCP ingest는 이 필드를 채운다. 모르면 write로 분류한다.

### Decision: Security lands with the connector phase

Context:
- HTTP/Webhook을 연 뒤 Phase 11에 SSRF·timeout·auth를 미루면 그 사이에 구멍이 열린다.

Decision:
- HTTP 페이즈에 SSRF allowlist(연결 base URL), timeout, 응답 크기 상한, 재시도/idempotency 기본값을 같이 넣는다.
- Webhook 페이즈에 공유 비밀/서명, localhost bind, payload 크기 상한을 같이 넣는다.
- RDB 페이즈를 새로 열 필요는 없다. 기존 SELECT allow-list를 유지하고 문서에 적는다.

### Decision: Knowledge data contract

Context:
- 지식 계층은 방향만 있고 타입이 없었다.

Decision:
- 최소 타입: `SearchHit`, `SourceRef`, `Citation`, `ResourceSnapshot`, `IndexDocument`.
- Phase 6 전: bounded list/read/search tool만. 인덱스 없음.
- Phase 6 후: 큰 소스만 로컬 인덱스로 후보를 좁힌 뒤 같은 read tool로 본문을 가져온다.
- 인덱스 규칙: 연결 ACL 밖 문서는 검색 안 됨. 원본 삭제/권한 회수 시 인덱스에서 제거(또는 히트 무효). stale이면 재조회 실패 시 인용하지 않음. 답변은 `Citation`을 붙인다. 클라우드 모델에는 hit snippet 상한만.

### Decision: Saved-work selection protocol

Context:
- 모델이 임의의 workflow id를 만들어 `run`하면 북스타가 깨진다.

Decision:
- 평챗 실행은 이 순서만 허용한다: `workflows.list` → (모호하면 질문) → **store에 있는 id만** `workflows.run` 제안 → 해당 업무 게이트 → Runtime.
- `run` 인자는 list가 돌려준 id만. 생성·추측 금지.

### Decision: Phase 0 contracts, not a provider rewrite

Context:
- Codex/Claude CLI, API, Ollama adapter는 이미 있다. 빠진 것은 공유 descriptor와 invoker 경계다.
- provider를 새 페이즈로 재작성할 필요는 없다.

Decision:
- Phase 0에서 Tool/Connection/Trigger/Skill descriptor, lifecycle, ToolInvoker 인터페이스, knowledge 타입, **기존 provider의 structured output/tool-call 봉투**를 고정한다.
- 새 모델 백엔드를 최종 목표에 추가하지 않는다.

---

## Assumptions (not re-interviewed)

- 배포는 계속 1인 로컬 트레이 앱. 창 닫기 ≠ 퇴근. 멀티유저/SSO/사내 서버는 `docs/future.md`.
- UI 언어는 대화 / 업무 / 승인 / 활동. 내부 저장은 `workflow.json` / Workflow IR.
- HTTP ingest 기본값은 GET→`NONE`, 그 외→`EXTERNAL`. 평챗 허용과 승인은 `sideEffect`가 결정한다. 쓰기 도구는 `/` 또는 저장 업무만.
- 로컬 마크다운 폴더는 폴더 연결로 지식에 포함될 수 있다. 옵시디언 전용 앱이 아니다.
- Loop/Parallel/Wait 엔진, DB write, 웹 검색, n8n 런타임, 커넥터 마켓은 최종 목표 밖.

## Risks

- 평챗 실행(A)과 평챗 무작성(A)을 라우터가 헷갈리면 새 그래프를 몰래 만든다. 코드가 `create` vs `run`을 분리해야 한다.
- inbound webhook + 사용자 터널은 운영  variablility가 크다. localhost 동작과 “터널 URL을 연결에 저장”이 최소 완료선이다.
- Slack 읽기 스코프/권한은 보내기만 있던 OAuth와 다를 수 있다.
- OpenAPI/MCP 주입이 catalog 계약을 깨면 인터뷰/런타임이 동시에 깨진다. 등록은 sandbox 검증 후 catalog commit. 호출은 Invoker adapter 없이 구현하지 않는다.
- `/workflow` 저장을 enabled로 두면 의도치 않은 webhook/스케줄이 돈다. 기본은 disabled.

## Document map

| 문서 | 역할 |
|------|------|
| `docs/research/ax-north-star.md` | 이 파일. 비전 결정 로그 |
| `docs/plans/ax-north-star.md` | 요구사항, 아키텍처, 페이즈 |
| `docs/plans/ax-workspace-migration.md` | *현재* 구현된 워크스페이스 스냅샷 |
| `docs/research/ax-studio.md`, `docs/plans/ax-studio.md` | v1 freeze, historical |
| `docs/future.md` | 이번 북스타에도 안 넣는 것 |
