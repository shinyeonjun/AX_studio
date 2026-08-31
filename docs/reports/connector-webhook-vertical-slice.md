# Webhook vertical slice

2026-08-31 기준 `origin/main`에서 Webhook의 제품 사용 경로를 점검하고
보강한 기록이다.

## 사용 흐름

```text
설정 저장
  -> OS secret store에 공유 비밀 저장
  -> SQLite connections에 포트/라벨/터널 참고값만 저장
  -> TriggerEngine이 local HTTP listener 시작
  -> POST /hooks/{path} 인증·payload 제한·path 정규화
  -> active workflow의 webhook.inbound trigger 매칭
  -> trigger receipt claim
  -> WorkflowRuntime 실행
  -> executions Activity 기록
  -> receipt completed (동일 provider event id 재실행 방지)
```

Webhook request body, 비민감 헤더, path는 실행 입력으로 전달되며 인증용
헤더와 공유 비밀은 입력·Activity·renderer connection summary에 포함되지
않는다. provider가
`idempotency-key`, `x-event-id`, `x-webhook-id`, `x-github-delivery` 중 하나를
보내면 그 값이 workflow별 dedupe key의 일부가 된다. 키가 없으면 요청마다
새 UUID를 사용한다.

## 이번 보강

- TriggerEngine이 push transport의 현재 상태를 공개한다.
- Webhook 연결 요약은 listener가 실제로 `connected`일 때만 정상 연결로
  표시하며 `error` 상태와 오류를 설정 화면에서 확인할 수 있다.
- 연결 refresh가 실패하면 저장된 연결을 `connected: false`로 되돌리고
  오류를 보존한다.
- IPC 연결 성공 판정은 refresh 완료만 보지 않고 Webhook listener가 실제로
  실행 중인지 확인한다.
- 동일 event id의 두 POST, 포트 충돌, 중지 후 listener 종료를 회귀 테스트로
  고정했다.
- loopback 전용 수동 발신 도구와 secret/HMAC/중복/거부 요청 시나리오를
  `test/manual/README.md`에 추가했다.

## 저장 경계

- `connections`: connector, connected, port, label, tunnelUrl,
  secretStored, connectedAt, lastError
- OS secret store: 실제 Webhook 공유 비밀
- `trigger_receipts`: workflow별 dedupe key, 처리 상태, execution id,
  processing lease
- `executions`: trigger type, 상태, sanitized execution log

`202 accepted`는 HTTP 요청이 인증되어 실행 큐에 접수됐다는 뜻이지, downstream
워크플로가 성공했다는 뜻은 아니다. 실제 성공 여부는 Activity 실행 기록에서
확인해야 한다. 외부 터널 생성, provider webhook 등록, outbound Webhook은
아직 이 모듈의 책임이 아니다.

## 검증

- Core Webhook/TriggerEngine focused tests
- Desktop connection summary/lifecycle tests
- local integration runner
- Core/Desktop/test typechecks
- dependency-cruiser architecture check
- production build and Electron Product QA/E2E
- loopback-only manual helper `--check`
