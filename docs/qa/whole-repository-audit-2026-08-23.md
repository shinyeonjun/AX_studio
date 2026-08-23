# AX Studio Whole-Repository QA / Architecture Audit

Date: 2026-08-23 (Asia/Seoul)  
Scope: `D:\AX_studio` 전체 저장소, 현재 working tree 상태  
Mode: read-only audit; production source를 의도적으로 수정하지 않음

## 1. 결론 요약

AX Studio는 단순한 화면 시안이 아니다. `packages/core` 안에 인터뷰 → 계약/IR → 승인 정책 → 실행 런타임 → 트리거/스케줄러 → connector → 실행 이력까지 이어지는 실제 제품 코어가 있고, 로컬 데이터와 OS 자격 증명 저장 경계도 상당 부분 의식적으로 설계되어 있다.

다만 최종 제품 기준으로는 아직 출시 준비가 끝나지 않았다. 현재 작업트리의 가장 직접적인 출시 차단점은 `packages/core/src/interview/compile/builder.ts`의 중복 `parsed` 선언으로 core typecheck/build가 깨지고, 그 결과 전체 core test의 7개 suite가 변환 단계에서 실패한다는 점이다. 이 파일은 감사 시작 전부터 dirty 상태였던 사용자 변경 범위로 판단해 직접 고치지 않았다.

더 중요한 구조적 결론은 다음과 같다.

1. 코어의 경계와 정책 모델은 좋은 편이지만, Electron 단일 프로세스와 sql.js 전체 DB export 방식이 장기 실행·대용량 실행 이력·고빈도 트리거에 취약하다.
2. “실행된다”와 “한 번만/유실 없이/재시작 후에도 설명 가능하게 실행된다” 사이의 운영 보장이 아직 명세되지 않았다.
3. OpenAPI/MCP/RDB는 코드·fixture 수준의 기반은 있으나, 최종 사용자가 설정하고 저장하고 복구하는 desktop 제품 경로가 완성되지 않았다.
4. 보안 방어 의식은 강하다. 하지만 Codex Security Deep Scan 자체는 현재 권한 프로필 조건 때문에 시작되지 않았으므로, “보안 문제 없음”으로 해석하면 안 된다.
5. UI는 이번 dirty 변경에서 네비게이션·상태 표시·삭제 확인·초기 화면이 상당히 개선되었다. 기존 캡처 보고서의 일부 finding은 현재 소스 기준으로 stale하며, 남은 문제만 다시 판정해야 한다.

현재 판단: **코어 구조는 계속 투자할 가치가 높지만, 지금 상태를 최종 제품/출시 후보로 승인할 수는 없다. 먼저 품질 게이트와 실행 신뢰성을 복구해야 한다.**

## 2. 감사에 사용한 관점과 한계

적용한 관련 skill / workflow:

- `product-design:index` + `product-design:audit`: 데스크톱 첫 실행, `/once`, `/workflow`, 설정, Slack, 활동, 승인, 테마를 캡처·소스 대조하고 UX/접근성/상태 신뢰성을 검토했다.
- `codex-security:deep-security-scan`: 저장소 전체 보안 scan을 두 번 시도했다. 아래 권한 blocker로 discovery가 시작되지 않았다.
- `plugin-management` + `openai-docs`: Codex Security 연결 상태, TAC 권한과 managed filesystem permission 요구 조건을 확인했다.
- repository harness protocol: `.harness/goal.md`, `scope.yaml`, `evaluator.yaml`, `experiments.tsv`를 읽고 frozen evaluator 기준으로 검증했다.
- 추가 수동 레인: 기능 흐름, IPC, Electron 경계, connector, 트리거, scheduler, persistence, Python sidecar, 의존성, 배포 설정, 문서 재현성을 정적 검토했다.

이 저장소에 실질적으로 기여하지 않는 image generation, Figma, spreadsheet, presentation, Sites skill은 호출하지 않았다. 이 요청에서 “모든 skill”은 의미 있는 감사 레인을 모두 사용한다는 뜻으로 해석했으며, 무관한 자산 생성 skill을 억지로 실행해 결과를 오염시키지 않았다.

검토의 한계:

- 실제 Gmail OAuth, Slack workspace, 외부 HTTP API, PostgreSQL, 외부 터널을 연결한 운영 E2E는 이 환경에서 수행하지 않았다.
- 화면 캡처는 개발 build 기준이며 키보드 전수 탐색, 실제 screen reader, 125–200% zoom, high contrast, reduced motion 자동 검증은 별도 레인이 필요하다.
- Codex Security validated finding 목록은 생성되지 않았다. 수동 정적 검토와 `npm audit` 결과는 별도 근거다.

## 3. 실행/데이터 흐름 맵

```text
React renderer
  -> preload contextBridge (좁은 API 표면)
  -> Electron ipcMain handlers
  -> AxCore bootstrap
       -> AgentHarness / workspace chat / interview
       -> WorkflowRuntime
       -> TriggerEngine + Scheduler
       -> Gmail / Slack / local folder / HTTP / webhook / document / RDB modules
       -> WorkflowStore
            -> sql.js in-memory SQLite
            -> debounced full-file export to %LOCALAPPDATA%\AXStudio\data\ax-studio.db
       -> OS safeStorage credential files

Document path:
  Node core -> spawn Python worker per request -> stdin/stdout JSON
             -> artifact manifest/pages/chunks under document cache

PDF path:
  core produces HTML -> Electron hidden BrowserWindow -> Chromium printToPDF
```

좋은 경계:

- `packages/core`는 Electron/React를 import하지 않고 core test가 Electron 없이 실행된다.
- side effect와 capability catalog가 실행 정책의 중심이다.
- renderer는 `contextBridge`를 사용하고 `nodeIntegration: false`, `contextIsolation: true`를 사용한다.
- connector secret은 desktop에서 OS safeStorage로 분리하려는 방향이다.

주의할 경계:

- Electron main이 AI 호출, 파일 scan, Python spawn, DB full export, trigger 실행을 모두 같은 프로세스에서 조정한다.
- `packages/core`는 capability와 runtime을 잘 분리했지만, 일부 capability는 “정적 read”와 “untrusted source content read”를 한 boolean으로 묶고 있다.
- OpenAPI/MCP dynamic catalog는 process-local registry다. persistence와 reconnect lifecycle이 없다.

## 4. 현재 검증 결과

검증은 현재 dirty tree에서 다시 실행했다.

| Check | 결과 | 의미 |
|---|---|---|
| `npm test -w @ax-studio/core` | **FAIL** | 83 suites 중 76 suite는 수집/실행됐고 355 tests는 통과했지만, `builder.ts` transform 오류로 7 suite 실패 |
| `npx tsc -p packages/core/tsconfig.json --noEmit` | **FAIL** | `builder.ts:250`, `builder.ts:284`의 `parsed` 중복 선언 및 후속 타입 오류 |
| `npx tsc -p apps/desktop/tsconfig.json --noEmit` | PASS | 현재 dirty UI 변경 기준 desktop typecheck는 통과 |
| `npm run eval -w @ax-studio/core` | PASS | 11/11 eval 통과. 단, eval이 깨진 builder 경로를 전부 커버하지는 않음 |
| Python document-engine unittest | PASS with skips | 17 run, 15 passed, 2 skipped (`pypdf` 미설치) |
| `npm run build` | **FAIL** | core build가 같은 `builder.ts` 오류로 desktop build까지 도달하지 못함 |
| `git diff --check` | PASS | line-ending warning만 있고 whitespace error는 없음 |
| `npm ci --dry-run --ignore-scripts` | PASS | lockfile 기반 설치 계획은 완료. 실제 `node_modules`에는 별도 extraneous 잔여가 있음 |
| `npm audit --omit=dev` | **FAIL** | prod dependency 기준 10건: moderate 6, low 4, high/critical 0 |
| `npm ls --depth=0` | exit 0 but noisy | `better-sqlite3`, `drizzle-orm`, `exceljs`, 구버전 uuid 등 많은 extraneous package가 node_modules에 남음 |

현재 실패의 직접 증거: [builder.ts](D:/AX_studio/packages/core/src/interview/compile/builder.ts:249)에서 `InterviewDraftSchema.parse` 결과를 `parsed`로 선언한 뒤, 같은 함수 블록 [builder.ts](D:/AX_studio/packages/core/src/interview/compile/builder.ts:284)에서 `validateWorkflowIR` 결과를 다시 `parsed`로 선언한다. 이 오류는 lint 수준이 아니라 build/test transform을 차단한다.

## 5. 우선순위 분류

### P0 — 지금 바로 release gate를 막는 문제

#### AUD-P0-01. Core build/test가 현재 dirty tree에서 깨짐

근거: [builder.ts](D:/AX_studio/packages/core/src/interview/compile/builder.ts:250), [builder.ts](D:/AX_studio/packages/core/src/interview/compile/builder.ts:284).

영향:

- core package를 build할 수 없다.
- production build가 core 단계에서 중단된다.
- 인터뷰/컴파일 관련 7개 test suite는 test body가 실행되기 전에 transform 실패한다.

권고:

- `InterviewDraftSchema.parse` 결과명을 `normalizedDraft` 또는 `draftValue`로 변경하고 validation 결과는 `validatedIr`로 분리한다.
- 이 수정은 현재 사용자가 작업 중인 인터뷰 변경과 함께 원인/테스트를 묶어야 한다.
- 이후 `npm test`, core typecheck, eval, full build를 순서대로 다시 실행하고, test count가 baseline 대비 줄지 않았는지 확인한다.

#### AUD-P0-02. “전체 구현 완료” 문서와 실제 증거가 불일치

근거: [phase-11 report](D:/AX_studio/docs/reports/ax-north-star.phase-11.md:12)는 E2E 5개를 모두 unchecked로 남겨두면서 [phase-11 report](D:/AX_studio/docs/reports/ax-north-star.phase-11.md:27)는 “Phases 0–11 implementation complete”라고 선언한다.

영향:

- 팀이 “완료”를 기능 존재와 운영 검증 완료로 혼동한다.
- 문서의 status를 믿고 실제 Gmail/Slack/approval/trigger failure를 놓칠 수 있다.

권고:

- `Implemented`, `Mock-verified`, `Manual E2E-verified`, `Release-approved`를 별도 상태로 만든다.
- 체크되지 않은 E2E는 완료 문서에서 명시적으로 “미검증”으로 유지한다.
- 기능별 acceptance matrix를 두고 각 행에 fixture, mock, live sandbox, recovery evidence를 기록한다.

### P1 — 최종 제품 전에 반드시 해결할 문제

#### AUD-P1-01. Native workspace AI 호출에 IPC 경로 timeout/cancel이 연결되지 않음

근거: [runWorkspaceChat](D:/AX_studio/packages/core/src/workspace/chat.ts:158)는 Anthropic/OpenAI/Grok native path를 호출하지만 `WorkspaceChatOptions`에 abort signal이 없고, [interview-handlers.ts](D:/AX_studio/apps/desktop/electron/main/ipc/interview-handlers.ts:125)의 `sendChat`도 cancellation/timeout을 전달하지 않는다. Native 구현은 signal을 받을 수 있지만 [anthropic-native.ts](D:/AX_studio/packages/core/src/workspace/anthropic-native.ts:79), [openai-native.ts](D:/AX_studio/packages/core/src/workspace/openai-native.ts:64) 호출까지 실제 signal이 도달하지 않는다.

영향:

- provider가 응답하지 않거나 네트워크가 half-open이면 UI가 indefinite busy 상태가 될 수 있다.
- Electron main event handler가 오래 살아 있고, 사용자는 재시작 외에 취소 수단이 없다.

권고:

- IPC request마다 request id와 AbortController를 등록하고 renderer에 cancel API를 제공한다.
- provider별 hard timeout, retry budget, user-visible error taxonomy를 공통 adapter에서 적용한다.
- 성공적으로 외부 요청을 보냈지만 응답을 잃은 경우를 일반 timeout과 구분한다. 자동 재시도는 side effect provider에 적용하지 않는다.

#### AUD-P1-02. API 연결 테스트에도 timeout이 없음

근거: [api-verify.ts](D:/AX_studio/apps/desktop/electron/main/ai/api-verify.ts:2), [api-verify.ts](D:/AX_studio/apps/desktop/electron/main/ai/api-verify.ts:26), [api-verify.ts](D:/AX_studio/apps/desktop/electron/main/ai/api-verify.ts:42)의 fetch에 AbortController/timeout이 없다.

영향: 설정 화면의 “API 연결 테스트”가 네트워크 상태에 따라 영원히 `확인 중...`에 머물 수 있다.

권고: 모든 verification fetch에 5–10초 timeout, AbortError 메시지, provider별 상태 코드 분류를 적용한다.

#### AUD-P1-03. HTTP response maxBytes가 메모리 보호가 아님

근거: [request.ts](D:/AX_studio/packages/core/src/modules/http/request.ts:50)는 `response.arrayBuffer()`로 전체 응답을 먼저 메모리에 올린 뒤 slice한다.

영향:

- 서버가 수백 MB/GB 응답을 보내면 `maxBytes`보다 훨씬 큰 메모리를 먼저 할당한다.
- local desktop 앱이 OOM 또는 main process 지연에 빠질 수 있다.

권고:

- `ReadableStream.getReader()`로 읽으며 누적 바이트가 cap을 넘는 순간 reader를 cancel한다.
- Content-Length가 cap보다 크면 body를 읽기 전에 실패/절단한다.
- request body, header 개수/이름/값 길이, query/path 길이도 별도 제한한다.
- `timeoutMs`와 `maxBytes`는 호출자 입력을 받는다면 허용 범위로 clamp한다.

추가 정책 문제: [http connector](D:/AX_studio/packages/core/src/modules/http/connector.ts:63)는 HTTP 4xx/5xx를 log error로 남기지만 `ok: true`로 반환한다. “transport success”와 “business execution success”를 분리하려는 의도라면 result contract에 명시하고, 아니라면 4xx/5xx를 실패 execution으로 일관되게 처리해야 한다.

#### AUD-P1-04. sql.js 전체 DB export + 실행 log 전체 JSON은 확장성/내구성이 약함

근거: [db.ts](D:/AX_studio/packages/core/src/store/db.ts:163)의 adapter는 mutation 때 persist를 예약하고, [db.ts](D:/AX_studio/packages/core/src/store/db.ts:214)에서 `this.db.export()` 전체를 `.tmp`로 쓰고 rename한다. 실행 log는 [execution-repository.ts](D:/AX_studio/packages/core/src/store/repositories/execution-repository.ts:59)에서 매 log update마다 전체 JSON을 다시 쓴다. Runtime은 [engine.ts](D:/AX_studio/packages/core/src/runtime/engine.ts:123), [engine.ts](D:/AX_studio/packages/core/src/runtime/engine.ts:440)에서 이를 호출한다.

영향:

- 긴 실행·고빈도 trigger에서 매번 전체 DB를 serialize/write한다.
- 250ms debounce 이전 crash는 최근 변경을 잃을 수 있다.
- `.tmp` write 중 강제 종료, 디스크 부족, rename 실패 시 복구 경로가 없다.
- 여러 프로세스/창/향후 headless worker가 같은 파일을 열면 lock 충돌을 해결하지 못한다.
- `executions.log_json`, chat messages, workflow versions에 retention/size policy가 없다.

권고:

- 장기 목표는 native SQLite 또는 WAL-capable adapter로 전환한다. 당장 전환하지 않더라도 log append batching, flush acknowledgement, backup rotation을 추가한다.
- schema version table과 migration transaction을 도입한다.
- `workflow_versions`, `executions`, `workspace_chats`에 보존 정책과 UI export/delete 정책을 만든다.
- startup 시 DB integrity check, `.bak` fallback, corrupted DB quarantine/restore 안내를 제공한다.
- `workflow_versions.workflow_id + version` unique index, execution/approval/workflow foreign key 정책, 필요한 timestamp index를 명시한다.

#### AUD-P1-05. Trigger delivery guarantee가 at-most/at-least-once 중 어느 것도 명확하지 않음

근거: [trigger-engine.ts](D:/AX_studio/packages/core/src/runtime/trigger-engine.ts:164) push event는 `recentEvents`에 이미 있는지 확인하고, [trigger-engine.ts](D:/AX_studio/packages/core/src/runtime/trigger-engine.ts:185) workflow execution을 await한 뒤 성공/approval이면 [trigger-engine.ts](D:/AX_studio/packages/core/src/runtime/trigger-engine.ts:190)에서 기억한다. Webhook은 [listener.ts](D:/AX_studio/packages/core/src/triggers/webhook/listener.ts:105)에서 event handler를 호출하고 [listener.ts](D:/AX_studio/packages/core/src/triggers/webhook/listener.ts:131) 즉시 202를 보낸다.

영향:

- 같은 push event가 동시에 두 번 들어오면 둘 다 `has` 검사에 통과한 뒤 외부 side effect를 두 번 실행할 수 있다.
- process restart 후 `recentEvents`가 사라진다.
- webhook caller는 202를 받았지만 app crash/handler failure 전에 durable queue가 없어 event가 유실될 수 있다.
- 외부 send가 성공했지만 process가 응답 전에 죽는 경우 재전송/중복 중 어느 쪽을 택할지 알 수 없다.

권고:

- event receipt/idempotency key를 DB에 durable하게 기록하고 execution과 atomic claim한다.
- push는 `inFlightKeys`를 먼저 claim한 뒤 처리하며, 결과에 따라 retry/dead-letter를 명시한다.
- webhook은 최소한 receipt row를 먼저 기록하고, 202의 의미를 “queued”로 정의한다.
- side-effect connector마다 provider request id/idempotency key를 전달할 수 있는지 확인한다.
- 중복 방지 목표를 “exactly once”라고 쓰지 말고, 시스템이 실제로 제공하는 at-least-once + idempotent action 모델을 문서화한다.

#### AUD-P1-06. 한 push transport의 refresh 실패가 다른 transport까지 막을 수 있음

근거: [trigger-engine.ts](D:/AX_studio/packages/core/src/runtime/trigger-engine.ts:127)에서 `PUSH_TRIGGER_DRIVERS`를 순차 refresh하며 각 `driver.refresh`에 독립적인 try/catch가 없다.

영향: Slack Socket Mode가 실패하면 뒤에 있는 webhook listener도 시작되지 않을 수 있다. 설정 화면에서 한 connector 오류가 다른 자동화까지 멈추는 구조다.

권고: driver마다 결과를 `running/degraded/failed`로 저장하고, 개별 실패가 전체 refresh를 중단하지 않게 한다. 재연결 backoff와 last error를 connector별로 노출한다.

#### AUD-P1-07. Cloud plain chat와 “metadata/snippet은 가능” 제품 설명이 실제 정책과 어긋날 가능성

근거: desktop context는 [design-tool-context.ts](D:/AX_studio/apps/desktop/electron/main/ipc/design-tool-context.ts:43)에서 cloud provider에 `allowUntrustedData: false`를 넣는다. 그런데 [capabilities-invoke.ts](D:/AX_studio/packages/core/src/design-tools/tools/capabilities-invoke.ts:20)는 plain chat에서 이 값이 false면 capability read 전체를 `source_content_requires_local_ai`로 차단한다. 반면 `sources.search`는 snippet policy를 별도로 갖는다.

영향:

- cloud plain chat에서 Slack/Gmail의 안전한 metadata/read capability까지 전부 막힐 수 있다.
- 사용자에게 “연결된 리소스를 조회할 수 있다”고 보이지만 실제로는 local AI만 가능한 기능이 된다.

권고:

- `untrusted source content`, `metadata`, `safe structured result`를 타입/정책으로 분리한다.
- capability마다 data class를 선언하고 cloud provider에는 allowlist로 metadata/짧은 snippet만 허용한다.
- prompt injection 방어와 raw body 차단을 유지하면서, Slack search result의 citation/field별 redaction 테스트를 추가한다.

#### AUD-P1-08. RDB는 catalog/core 구현은 있으나 desktop 사용 경로가 없음

근거: [catalog-data.ts](D:/AX_studio/packages/core/src/modules/packages/catalog-data.ts:330)의 `RDB_CATALOG`가 `connectable: false`이고 desktop IPC/settings에는 RDB 연결 handler/form이 없다. 구현체는 [rdb connector](D:/AX_studio/packages/core/src/modules/rdb/connector.ts:13)다.

영향:

- README와 frozen plan은 v1 read-only RDB를 약속하지만 사용자가 connection string/file path/allowed tables/row limit을 설정할 수 없다.
- 현재는 mock/test 또는 내부 wiring이 아니면 제품 기능으로 검증할 수 없다.

권고:

- RDB를 v1에서 유지할지, 명시적으로 future로 내릴지 먼저 결정한다.
- 유지한다면 UI/IPC/OS secret/config schema/connection test/allowed schema preview/삭제·재연결·startup hydration을 끝까지 연결한다.
- Postgres password/connection string은 DB JSON에 inline 저장하지 말고 OS credential ref로 분리한다.

추가 RDB 결함:

- PostgreSQL `client.connect()` 후 query 예외 시 `client.end()`가 보장되지 않는다.
- statement timeout/network timeout이 없다.
- SQLite `schema.describe`는 `allowedTables`를 적용하지 않고 전체 table name을 반환한다.
- `rowLimit`의 범위가 config에서 clamp되지 않는다.
- `openReadonlySqlite`는 파일 크기 cap/경로 policy 없이 전체 파일을 memory load한다.

#### AUD-P1-09. OpenAPI/MCP는 library/fixture 단계이며 실제 desktop lifecycle이 없음

근거: OpenAPI는 [ingest.ts](D:/AX_studio/packages/core/src/openapi/ingest.ts:9)에서 process-local dynamic catalog에 등록한다. MCP의 production client interface는 [client.ts](D:/AX_studio/packages/core/src/mcp/client.ts:8)지만 현재 구현된 concrete client는 `MockMcpClient`이며 test에서 사용된다.

영향:

- 서버 URL/spec/credential을 desktop에서 등록·저장·재부팅 후 복구하는 경로가 없다.
- dynamic capability가 process restart 시 사라진다.
- phase report의 “OpenAPI read + MCP read”는 mock/library proof와 live product capability를 혼동한다.

권고:

- real transport/credential/lifecycle을 만들기 전까지 UI에서 capability를 노출하지 않는다.
- spec/schema validation, operation parameter schema, auth policy, base URL SSRF policy, refresh/reconnect, delete/unregister를 설계한다.
- MCP tool inputSchema를 실제 native tool schema로 전달하고, tool call 결과의 untrusted data policy를 적용한다.

#### AUD-P1-10. Electron startup/runtime failure가 사용자에게 복구 경로를 제공하지 않음

근거: [index.ts](D:/AX_studio/apps/desktop/electron/main/index.ts:39)의 `uncaughtException`/`unhandledRejection`은 console만 남긴다. [index.ts](D:/AX_studio/apps/desktop/electron/main/index.ts:47) startup catch도 [index.ts](D:/AX_studio/apps/desktop/electron/main/index.ts:96)에서 log만 남긴다.

영향: DB corruption, safeStorage failure, missing Python, port conflict 등으로 startup이 실패해도 process가 살아 있는 것처럼 보이거나 tray/UI가 뜨지 않는 “멈춘 앱”이 될 수 있다.

권고:

- startup 단계별 health state를 기록하고, window를 만들 수 있으면 recovery screen을 표시한다.
- window를 만들 수 없으면 tray notification/dialog와 diagnostic log path를 제공한다.
- uncaught exception은 단순 무시하지 말고 controlled shutdown 또는 degraded mode로 전환한다.
- 마지막 startup phase, error code, data root, migration state를 support bundle로 export할 수 있게 한다.

#### AUD-P1-11. Renderer IPC에 sender/origin 방어 계층이 없음

근거: [ipc-handle.ts](D:/AX_studio/apps/desktop/electron/main/ipc/ipc-handle.ts:3)는 handler 등록만 하고 sender 검증을 하지 않는다. [app-window.ts](D:/AX_studio/apps/desktop/electron/main/app-window.ts:16)는 context isolation/nodeIntegration은 설정하지만 navigation/open-window/CSP guard가 없다.

영향: 현재 renderer가 정상 local bundle이라는 전제에 의존한다. 미래의 renderer XSS, 잘못된 navigation, dev URL 오염이 있으면 privileged IPC 호출 표면이 방어 없이 노출된다.

권고:

- 모든 `ipcMain.handle`에 trusted window id/origin 검증 wrapper를 둔다.
- `will-navigate`, `setWindowOpenHandler`, `web-contents-created`에서 외부 navigation/window를 차단한다.
- production CSP를 설정하고 `script-src`/`connect-src` 범위를 좁힌다.
- PDF print hidden window에는 명시적 sandbox/CSP와 HTML size cap을 적용한다.

현재 장점: `contextIsolation: true`, `nodeIntegration: false`는 올바른 기본값이다. 이것을 sender validation의 대체로 보지는 말아야 한다.

#### AUD-P1-12. Production packaging/installer/update/signing 경로가 사실상 없음

근거: [apps/desktop/package.json](D:/AX_studio/apps/desktop/package.json:5)의 scripts에는 dev/build/preview만 있고, `electron-builder` dependency는 있으나 builder config, package/release/update/signing script가 발견되지 않았다.

영향:

- 사용자가 설치할 수 있는 Windows artifact, upgrade, rollback, code signing, Python sidecar 포함 여부를 검증할 수 없다.
- `defaultWorkerScript()`가 source tree의 `packages/document-engine/src/worker.py`를 찾는 개발 환경 전제에 머물 수 있다.

권고:

- `pack:win`, artifact smoke test, installer upgrade test, uninstall/data retention policy를 만든다.
- Python worker/venv/Docling을 어떻게 배포할지 결정한다. README도 frozen runtime 또는 first-use download가 future task라고 명시한다.
- Electron signing/update metadata와 release channel을 정의한다.
- packaged app에서 worker script, Python, WASM, templates, images, credential path가 실제로 존재하는지 CI에서 검증한다.

#### AUD-P1-13. Dependency audit에서 production vulnerability 10건

검증: `npm audit --omit=dev --json` 결과 moderate 6, low 4, high/critical 0. 직접 관련된 package에는 `ai@4.3.19`, `@ai-sdk/openai-compatible@0.2.16`, `googleapis@144.0.0`가 포함되고, transitive `uuid`, `gaxios`, `googleapis-common`, `jsondiffpatch`, provider-utils 경로가 포함된다.

영향: 현재 high/critical은 없지만, AI SDK의 resource consumption/file type 처리와 Google dependency의 transitive advisory를 release에 그대로 가져간다.

권고:

- 바로 major upgrade를 일괄 실행하지 말고, advisory별 reachable code path와 breaking change를 확인한다.
- `npm audit`를 CI gate로 두되, exploitability/exception 문서를 함께 관리한다.
- AI SDK를 실제로 쓰는 경로와 legacy/unused dependency를 분리한다.
- lockfile을 release artifact에 고정하고 periodic dependency review를 예약한다.

#### AUD-P1-14. Synchronous local-folder scan이 main/runtime을 막을 수 있음

근거: [scan.ts](D:/AX_studio/packages/core/src/modules/local-folder/scan.ts:1)는 `readdirSync`/`lstatSync` 재귀를 사용하고, [indexer.ts](D:/AX_studio/packages/core/src/retrieval/indexer.ts:50)는 scan 후 파일을 동기 read한다. [search.ts](D:/AX_studio/packages/core/src/retrieval/search.ts:51)는 `rebuild: true`이면 검색마다 rebuild한다.

영향:

- 5,000개 파일 폴더, network share, 느린 antivirus 환경에서 Electron main이 멈출 수 있다.
- 파일 수 cap은 있지만 총 scan time/total directory count/aggregate bytes cap이 없다.

권고:

- scan/index build를 worker thread/child process로 옮기고 progress/cancel을 제공한다.
- metadata snapshot과 incremental index를 사용해 매 search full rebuild를 없앤다.
- total bytes, elapsed time, directory count, unreadable count를 제한·기록한다.

### P2 — 다음 hardening cycle에서 해결할 문제

#### AUD-P2-01. Persistence migration/backup/locking이 부족함

근거: [db.ts](D:/AX_studio/packages/core/src/store/db.ts:100)의 legacy rename과 [data-migrate.ts](D:/AX_studio/apps/desktop/electron/main/data-migrate.ts:48)의 copy migration은 versioned transaction/backup/hash verification/rollback이 없다.

개선:

- migration 전 DB backup, temp destination, fsync/verification, 실패 시 rollback을 구현한다.
- migration marker는 실제 row/file integrity 확인 뒤 작성한다.
- schema migration version을 code와 data에 함께 기록한다.

#### AUD-P2-02. Secret file write가 atomic하지 않음

근거: [credential-store.ts](D:/AX_studio/apps/desktop/electron/main/credential-store.ts:28), [credential-store.ts](D:/AX_studio/apps/desktop/electron/main/credential-store.ts:69)는 encrypted buffer를 바로 `writeFileSync`한다.

개선: temp file + flush/rename, stale temp cleanup, credential file corruption recovery, safeStorage availability diagnostics를 추가한다. OS safeStorage 자체는 좋은 방향이지만 “암호화된 파일”도 partial write에는 취약하다.

#### AUD-P2-03. HTTP SSRF 방어는 URL 문자열 기준이며 DNS rebinding/redirect 정책이 부족함

근거: [url-security.ts](D:/AX_studio/packages/core/src/modules/http/url-security.ts)에서 origin/base path와 redirect manual은 검사하지만 DNS resolve 후 private IP 재검증은 없다.

개선:

- 사용자가 임의 base URL을 넣을 수 있는 제품이면 DNS 결과의 loopback/private/link-local/reserved range를 검사하고 redirect 대상도 재검증한다.
- 기업 내부 URL을 허용할 경우 allowlist/explicit policy를 UI에 표시한다.

#### AUD-P2-04. Webhook listener에 운영 방어가 부족함

근거: [listener.ts](D:/AX_studio/packages/core/src/triggers/webhook/listener.ts:19)에는 payload byte cap은 있으나 Content-Length early reject, socket/request timeout, connection concurrency/rate limit, content-type policy가 없다.

개선: `request.setTimeout`, server headers timeout, in-flight cap, per-IP/token rate limit, Content-Length check, JSON/content-type option, metrics와 rejected count를 추가한다.

#### AUD-P2-05. Approval을 만들기 전에 action parameter validation을 끝내지 않음

근거: runtime step executor는 external action boundary에서 approval을 먼저 만들고, 일부 malformed params/connector failure가 그 뒤에 드러나는 흐름이다.

영향: 사용자는 실행할 수 없는 action에 대해 승인하게 되고, 승인함에 무의미한 pending 항목이 생길 수 있다.

개선: capability contract, bound params, connector availability, data policy를 먼저 검증한 뒤 approval snapshot을 만든다. approval reason에 실제 target/side effect summary를 포함한다.

#### AUD-P2-06. Workspace chat 저장과 provider 실행이 원자적이지 않음

근거: renderer hook은 provider 응답 뒤 `saveWorkspaceChat`을 별도 호출한다. 저장 실패 시 provider는 이미 요청을 처리했지만 UI는 error로 끝나고 retry 시 중복 요청이 가능하다.

개선: client message id/idempotency key, unsaved state, retry-safe persistence, provider request와 local save의 reconciliation 상태를 둔다.

#### AUD-P2-07. History/context에 token budget과 retention이 없음

근거: IPC의 count/character bound는 있지만 [workspace-chat-repository.ts](D:/AX_studio/packages/core/src/store/repositories/workspace-chat-repository.ts:10)의 core schema에는 message count/length bound가 없다. 모델 호출은 저장된 전체 history를 계속 보낼 수 있다.

개선: per-message/per-chat/total token budget, summary compaction, oldest-message policy, DB size budget, user export/delete를 도입한다.

#### AUD-P2-08. Connection/config JSON 한 row 손상이 전체 state load를 깨뜨릴 수 있음

근거: [settings-repository.ts](D:/AX_studio/packages/core/src/store/repositories/settings-repository.ts:44)는 한 connection JSON parse 실패 시 throw한다.

개선: row별 degraded record를 반환하고 UI에 “복구 필요”를 보여준다. 단, credential/secret 손상은 안전하게 disconnected로 만들되 silent data loss가 되지 않도록 diagnostic event를 남긴다.

#### AUD-P2-09. Workflow version/execution/chat의 index 및 retention 설계가 없음

근거: [db.ts](D:/AX_studio/packages/core/src/store/db.ts:18)의 migration에는 PK 외에 주요 조회 index와 unique version constraint가 없다. `workflow_versions`는 계속 쌓인다.

개선: 최신 version 조회, started_at 목록, pending approval, workflow foreign key 등에 index를 추가하고, revision 보존/삭제/export 정책을 명시한다.

#### AUD-P2-10. Scheduler의 retry/DST/clock semantics가 문서화되지 않음

근거: [scheduler.ts](D:/AX_studio/packages/core/src/runtime/scheduler.ts:118)는 scheduled minute에 먼저 `markFired`하고 실행한다. 실패 후 retry policy가 없고, timezone `Intl` 계산만으로 DST ambiguous/nonexistent minute을 처리한다.

개선: missed run, failure retry, clock rollback, DST behavior, once failure retention을 acceptance test로 고정한다.

#### AUD-P2-11. RDB/HTTP/MCP native tool schema가 모델에 충분히 전달되지 않음

근거: native tool definitions의 input schema가 empty properties + `additionalProperties: true` 형태다. 실행 시점 validation은 있어도 모델이 올바른 인자를 생성하도록 돕는 계약이 약하다.

개선: capability param schema에서 provider tool schema를 생성하고, invalid args는 명시적 tool result로 한 번만 교정하도록 한다.

#### AUD-P2-12. Document engine은 sidecar 계약은 좋지만 packaged deployment와 resource limits가 미완성

좋은 점: [artifact_store.py](D:/AX_studio/packages/document-engine/src/artifact_store.py:54)는 payload를 먼저 쓰고 manifest를 atomic commit marker로 교체한다. artifact id traversal 검사와 cache fingerprint test도 있다.

남은 문제:

- worker request의 source/template/artifact root에 size/time/resource policy가 desktop boundary에서 일관되게 적용되어야 한다.
- Python process는 request마다 spawn되므로 대용량 PDF/OCR에서 startup cost가 크다.
- `pypdf`가 없어도 test가 skip되어 PDF 실제 기능이 항상 검증되는 것은 아니다.
- Docling/한국어 OCR model download, cache, offline failure, packaged path를 release에서 검증해야 한다.

#### AUD-P2-13. UI residual: guide placeholder가 제품 화면에 노출됨

근거: [ConnectionGuide.tsx](D:/AX_studio/apps/desktop/src/components/settings/ConnectionGuide.tsx:34)은 guide asset이 없으면 `slack-guide.png` 같은 placeholder와 Slack용 고정 설명을 표시한다.

권고: 실제 asset을 패키지에 넣거나 provider별 production setup copy로 대체한다. “이미지 넣으면 표시”류의 개발 문구는 제거한다.

#### AUD-P2-14. UI residual: 제품 언어에 `workflow.json`이 남아 있음

근거: [WorkspaceReviewCard.tsx](D:/AX_studio/apps/desktop/src/components/workspace/WorkspaceReviewCard.tsx:38), [WorkspaceReviewCard.tsx](D:/AX_studio/apps/desktop/src/components/workspace/WorkspaceReviewCard.tsx:76)에서 최종 사용자에게 `workflow.json`을 저장한다고 표시한다.

권고: 기본 UI는 “업무 저장/실행”으로 쓰고, IR/export가 필요할 때만 고급 정보로 노출한다.

#### AUD-P2-15. UI residual: local folder 제거에 entity-specific confirmation이 없음

근거: [LocalFolderConnectionForm.tsx](D:/AX_studio/apps/desktop/src/components/settings/connectors/LocalFolderConnectionForm.tsx:69)에서 제거를 바로 호출한다.

권고: 폴더 label/path, 해당 폴더를 사용하는 업무 수, index/cache 영향, undo 가능 여부를 확인 후 제거한다.

#### AUD-P2-16. UI residual: AI 모델 label이 input/select와 programmatic association이 없음

근거: [AiBrandForm.tsx](D:/AX_studio/apps/desktop/src/components/settings/ai/AiBrandForm.tsx:151)의 `<label>모델</label>`은 `htmlFor`/select id가 없다.

권고: 모든 form field에 stable id + htmlFor + error/help description을 적용하고 axe/keyboard regression을 CI에 넣는다.

#### AUD-P2-17. UI responsive/zoom/accessibility는 아직 증명되지 않음

이번 dirty source에서 navigation은 `aria-current`, state banner는 `role=alert/status`, chat error는 `role=alert`, Gmail email masking, Slack degraded state, delete confirmation이 개선되었다. 기존 캡처 문서의 PD-01/03/04/07/08/11/12/15 일부는 현재 source 기준 stale이다.

남은 검증:

- 1024/800/640px과 125/150/200% zoom에서 sidebar/settings grid clipping
- focus ring, keyboard-only path, escape/arrow behavior
- screen reader에서 nav/current page, approval action, provider status
- contrast token, reduced motion, high contrast

캡처 기반 기존 문서: [product-design-audit](D:/AX_studio/docs/qa/product-design-audit-2026-08-23.md). 이 문서는 source 변경 전 finding을 포함하므로 current truth로 그대로 사용하지 말고 재캡처 후 갱신해야 한다.

## 6. 데이터 저장/보안 세부 판단

### 잘 된 부분

- credential path segment를 엄격히 제한한다: [credential-paths.ts](D:/AX_studio/apps/desktop/electron/main/credential-paths.ts:13).
- Slack/HTTP/Webhook secret을 desktop OS store로 이동하려는 hydration/migration 경계가 있다.
- Gmail credential은 DB record에 refresh token 대신 `credentialRef`를 저장하려는 방향이다.
- local folder path는 realpath/containment 검사를 사용한다.
- webhook HMAC/timing-safe 검증, payload cap, localhost binding이 있다.
- `contextIsolation`/`nodeIntegration` 기본값이 안전한 편이다.
- workflow/action catalog와 side effect validation이 저장/실행에 관여한다.
- Python artifact store는 manifest를 commit marker로 사용해 partial artifact를 cache hit로 보지 않으려 한다.

### 보완이 필요한 부분

- DB 자체는 plaintext local file이다. Windows ACL, backup/export, 다른 Windows user 접근, portable copy 정책을 문서화해야 한다.
- process.env에 AI secret을 넣으면 process lifetime 동안 memory에 남는다. provider refresh 시 이전 key lifecycle과 crash dump/log 노출 정책을 점검한다.
- state IPC는 connector config에서 secret을 제거하려고 하지만, 앞으로 connector가 늘면 “renderer-safe DTO”를 allowlist schema로 고정하는 편이 안전하다.
- log/error provider body를 그대로 사용자에게 전달하는 경로가 있어 secret/referrer/request metadata가 포함되지 않는지 provider별 redaction test가 필요하다.
- `printHtmlToPdf`는 arbitrary HTML을 hidden BrowserWindow에서 로드하므로 input size/CSP/navigation 정책을 추가해야 한다.

### Codex Security 상태

사용자가 Codex Security를 명시적으로 요청해 deep scan을 두 번 호출했다. 두 번 모두 같은 blocker로 중단됐다.

```text
Codex Security Deep Scan discovery did not start or rejoin.
Deep Scan cannot safely start a read-only worker: the parent must provide a managed filesystem permission profile.
```

두 번째 시점의 TAC connector 상태도 `status: not_granted`, `grants: []`였다. 따라서 이 저장소에는 Codex Security `scanId`, manifest, validated findings, no-findings report가 없다. 이 결과를 “취약점 없음”으로 읽으면 안 된다. 현재 보고서의 보안 판단은 수동 소스 검토 + npm audit이며, managed read-only permission profile을 제공할 수 있을 때 Security scan을 별도로 다시 통과시켜야 한다.

## 7. 문서/구현 drift

현재 source와 frozen plan 사이에 의사결정이 필요한 drift가 있다.

| 문서가 말하는 것 | 현재 확인된 것 | 조치 |
|---|---|---|
| Node 24 / Electron 43 / pnpm | root engine Node `>=22`, npm workspaces, Electron 34 | 실제 release target을 하나로 결정 |
| drizzle + better-sqlite3 | 현재 `sql.js` file export | plan을 갱신하거나 storage migration 계획을 명시 |
| TypeScript 하나 | 실제 Python document-engine sidecar | “TS core + optional Python engine”으로 문서화 |
| v1 RDB | catalog `connectable:false`, desktop setup 없음 | 기능을 완성하거나 v1 scope에서 내림 |
| HTTP generic call은 v1 제외 | 현재 HTTP connector/UI가 존재 | security/UX/지원 범위를 공식화 |
| Webhook future/non-goal 문구 | 실제 listener/trigger/UI 존재 | STRUCTURE/plan drift 제거 |
| OpenAPI/MCP phase complete | library/mock ingest만 확인 | live lifecycle 여부를 status로 분리 |
| full test/build regression gate | 현재 builder 오류로 test/build fail | CI gate를 실제 현재 상태와 맞춤 |

`packages/core/src/STRUCTURE.md`의 reserved/future 설명과 실제 module package 목록도 일부 어긋난다. 문서는 architecture source of truth인지 historical note인지 front matter로 분명히 해야 한다.

## 8. 추천 실행 순서

### Phase 0 — working tree와 품질 게이트 복구

완료 기준:

- 인터뷰 변경을 작은 commit/patch로 분리한다.
- `builder.ts` duplicate variable을 해결한다.
- core test 전체 suite, core typecheck, desktop typecheck, eval, Python test, build, diff-check를 모두 green으로 만든다.
- test file count/test count가 의도치 않게 감소하지 않았음을 확인한다.

### Phase 1 — 실행 중 멈춤/중복/유실 방지

순서:

1. AI/API/HTTP/document worker timeout + cancellation
2. HTTP streaming byte cap / request bounds
3. trigger durable idempotency + in-flight claim + webhook queue/receipt
4. push transport per-driver isolation
5. approval preflight ordering

완료 기준: provider hang, duplicate webhook, simultaneous duplicate push, restart-after-202, side-effect timeout 시나리오를 mock integration test로 재현하고 기대 상태를 고정한다.

### Phase 2 — 저장소 내구성

순서:

1. schema version/migration transaction/backup
2. DB integrity check + recovery UX
3. log batching/retention/index/size budget
4. atomic credential writes
5. chat summary/context compaction

완료 기준: 강제 종료/디스크 실패/손상 DB/구버전 DB migration/대용량 execution log를 fixture로 검증한다.

### Phase 3 — 약속한 connector의 제품 경로

먼저 scope 결정을 한다.

- RDB를 v1에 유지하면 desktop connection flow를 끝까지 구현한다.
- OpenAPI/MCP를 제품 메뉴에 노출하지 않을 거면 library-only로 분류하고 phase report에서 완료라고 쓰지 않는다.
- HTTP/Webhook은 이미 UI가 있으므로 rate limit, auth storage, status, package smoke test까지 책임진다.

완료 기준: fresh profile에서 연결 → 재시작 → 상태 복구 → capability 사용 → 실패/해제 → 데이터 redaction까지 각 connector를 반복한다.

### Phase 4 — Product UX/accessibility

현재 source에서 이미 개선된 navigation/state/deletion 흐름을 보존하면서 다음만 집중한다.

- guide placeholder 제거
- `workflow.json` 제품 언어 제거
- folder deletion confirmation
- form id/label/error description 정리
- responsive/zoom/screen reader/contrast/reduced motion audit
- Slack capability status와 last check/retry semantics의 일관성

완료 기준: keyboard-only acceptance matrix와 axe/contrast automated check, 1024/800/640px 및 200% zoom screenshot set.

### Phase 5 — 배포/운영

- Windows installer + signing + update/rollback
- packaged Python/document worker and sql.js WASM smoke test
- clean machine install, upgrade, uninstall, data preservation
- startup recovery screen/tray diagnostics
- support bundle/log rotation/privacy policy
- release SBOM/dependency audit exception record

## 9. 지금 하지 말아야 할 것

- 현재 build가 깨진 상태에서 큰 architecture rewrite를 시작하지 않는다.
- npm audit를 이유로 모든 dependency를 한 번에 major upgrade하지 않는다.
- RDB/OpenAPI/MCP의 product route가 없는 상태에서 connector logo/UI를 더 추가하지 않는다.
- sql.js를 바로 갈아엎기 전에 실제 log write rate, DB size, crash recovery requirement를 측정한다.
- 기존 UI 캡처 보고서의 stale finding을 그대로 티켓화하지 말고 현재 source와 다시 대조한다.

## 10. 최종 판단

AX Studio의 가장 큰 자산은 “자연어 → 구조화된 업무 계약 → 승인/실행 정책 → 로컬 데이터”라는 제품 중심 경계가 이미 코드에 있다는 점이다. 특히 side-effect 분리, bounded agent loop, connector catalog, secret 분리, local path security, artifact manifest 같은 선택은 최종 제품으로 발전시킬 수 있는 기반이다.

가장 큰 위험은 기능 수가 아니라 **신뢰성의 계약이 아직 약한 상태에서 완료 문서와 화면이 앞서가는 것**이다. 사용자가 이 앱을 업무 자동화에 맡기려면 “응답이 왔다”보다 다음을 보장해야 한다.

- 언제 멈췄는지
- 왜 멈췄는지
- 외부 side effect가 실제로 한 번만 실행됐는지
- 재시작 후 무엇을 복구할 수 있는지
- 어떤 데이터가 어느 AI/provider로 갔는지
- 설정/연결/승인/삭제가 실패했을 때 사용자가 되돌릴 수 있는지

따라서 다음 실제 engineering task는 새 기능 추가가 아니라 **P0 build 복구 → timeout/trigger/persistence reliability → 실제 connector E2E → package/recovery** 순서가 가장 합리적이다.
