# North Star QA Scenarios

Manual checks you should still do occasionally (real Gmail/Slack/folder). Everything else is automated in `packages/core/src/north-star/north-star-qa.test.ts`.

| # | 시나리오 | 자동 | 수동 |
|---|----------|------|------|
| 1 | 평챗 Slack/Gmail/PDF 조회, citation·정책 | `north-star-qa` §1, `slack-read.test` | 실제 계정 1회 |
| 2 | 저장 업무 `workflows.list` → `run`, unknown id 거부 | `north-star-qa` §2, `design-tools.test` | UI에서 말로 실행 1회 |
| 3 | `/once` ephemeral snapshot | `north-star-qa` §3, `engine.test` | 그래프→실행 UX |
| 4 | 저장=disabled, 활성화 후 trigger | `north-star-qa` §4, `trigger-engine.test` | webhook curl 1회 |
| 5 | 승인 게이트·거절·연결 해제 | `north-star-qa` §5, `engine.test` | 승인 탭에서 거절 1회 |
| 6 | 중복 승인/중복 발송 방지 | `north-star-qa` §6, `engine.test` | — |
| 7 | 클라우드에 원문 미전달 | `north-star-qa` §7, `harness-policy.test` | provider 로그 샘플 |

## 버그 발견 시 기록 형식

| 필드 | 내용 |
|------|------|
| 현상 | 무엇이 깨졌는지 |
| 기대 | 정상 동작 |
| 실제 | 관측된 동작 |
| 재현 | 입력/명령/슬래시 |
| ids | session id / execution id |
| 로그 | 활동 탭 또는 `executions.log_json` |
| 회귀 | `north-star-qa` 또는 단위 테스트 추가 여부 |

## 실행

```powershell
npm test -w @ax-studio/core
npm test -w @ax-studio/core -- src/north-star/north-star-qa.test.ts
npm run eval -w @ax-studio/core
```

## 로그 분석

실행 로그는 `packages/core/src/runtime/execution-log.ts` 헬퍼로 파싱합니다.

- `http.request_failed` — HTTP 4xx/5xx 또는 네트워크 오류
- `openapi.request_failed` — OpenAPI adapter 실패
- `mcp.tool_call_failed` — MCP 호출 실패
- `waiting_approval` — 승인 대기 (실패 아님)
