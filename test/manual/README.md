# AX Studio 수동 테스트 픽스처

실제 앱을 켜 둔 채로 REST API와 PostgreSQL을 매번 새로 만들 필요 없이,
한 명령으로 로컬 픽스처를 띄우고 끝나면 깨끗하게 정리합니다. Webhook은
앱의 로컬 수신 리스너로 보내는 전용 발신 도구를 제공합니다.

## 요구 사항

- Node.js (레포 개발 환경 그대로)
- Docker Desktop 실행 중 (PostgreSQL 픽스처용)

## 실행

```bash
# REST + PostgreSQL 동시 실행 (권장)
npm run test:manual

# 개별 실행
npm run test:manual:http   # REST API만
npm run test:manual:db     # PostgreSQL만
npm run test:manual:webhook -- --check  # Webhook 발신 도구 자체 확인
```

시작하면 아래 값이 출력됩니다. Ctrl+C 로 종료하면 REST 프로세스와
이 픽스처가 만든 PostgreSQL 컨테이너(`ax-manual-postgres`)만 정리됩니다.

| 리소스 | 기본값 | 환경변수 |
| --- | --- | --- |
| REST base URL | `http://127.0.0.1:4820` | `AX_MANUAL_REST_PORT` |
| PostgreSQL | `postgresql://postgres:axstudio@127.0.0.1:54329/axmanual` | `AX_MANUAL_PG_PORT` |

## REST 픽스처 엔드포인트

- `GET /health` — 상태 확인
- `GET /items` — 목록 조회
- `GET /items/:id` — 단건 조회
- `POST /items` — JSON 생성 (`{ "name": "...", "status": "pending", "amount": 123 }`)

데이터는 프로세스 메모리에만 존재하며 외부 네트워크에 나가지 않습니다.

## PostgreSQL 시드 데이터

`public.customers` (5행, 결정적 시드):

| id | name | plan | monthly_fee |
| --- | --- | --- | --- |
| 1 | 김민준 | pro | 49000 |
| 2 | 이서연 | basic | 19000 |
| 3 | 박지훈 | pro | 49000 |
| 4 | 최수아 | enterprise | 190000 |
| 5 | 정도윤 | basic | 19000 |

## AX Studio 스모크 시나리오

1. `npm run test:manual` 로 픽스처를 띄웁니다.
2. AX Studio 설정 → 데이터베이스 연결에서 위 PostgreSQL 연결 문자열로 연결합니다.
3. 설정 → API(REST) 연결에서 base URL `http://127.0.0.1:4820` 을 인증 없이 연결합니다.
4. 채팅에서 요청합니다. 예:
   - "customers 테이블에서 pro 요금제 고객만 뽑아줘"
   - "그 결과를 요약해서 items API에 POST 해줘" → 승인 게이트에서 POST 내용을 확인 후 승인
5. (선택) Gmail/Slack이 이미 연결돼 있다면, 만들어진 요약을 검토한 뒤
   본인 계정으로 발송하는 단계까지 이어서 확인합니다. 외부 발송은 반드시
   승인 화면에서 내용을 검토한 뒤에만 진행하세요.
6. 확인이 끝나면 픽스처 터미널에서 Ctrl+C — REST 서버 종료, `ax-manual-postgres`
   컨테이너 삭제까지 자동으로 정리됩니다.

## Webhook 수동 스모크

1. AX Studio 설정 → Webhook에서 로컬 포트(기본 `18789`)와 공유 비밀을
   저장합니다. 연결 성공 후 `http://127.0.0.1:18789/hooks/`가 표시되어야
   합니다.
2. `webhook.inbound` 트리거의 경로를 `invoice-paid`로 설정한 활성 워크플로를
   준비합니다. 외부 발송 액션이 있다면 첫 확인에서는 승인 단계가 있는
   워크플로를 사용합니다.
3. 별도 터미널에서 같은 event id를 두 번 보내 봅니다.

   ```bash
   npm run test:manual:webhook -- --url http://127.0.0.1:18789/hooks/invoice-paid --secret hook-secret --event-id manual-invoice-paid-1 --repeat 2
   ```

   두 번 모두 `202 accepted`가 나오고 Activity에는 실행이 한 건만 생겨야
   합니다. 실행 기록의 트리거가 `webhook.inbound`인지도 확인합니다.
4. HMAC 경로도 확인할 수 있습니다.

   ```bash
   npm run test:manual:webhook -- --url http://127.0.0.1:18789/hooks/invoice-paid --secret hook-secret --auth hmac --event-id manual-hmac-1 --repeat 1
   ```

5. 잘못된 비밀은 `401`, `GET /hooks/invoice-paid`는 `405`입니다. `/hooks/`
   밖의 경로는 `404`이고, 인증된 `/hooks/unknown`은 재시도 폭주를 막기 위해
   `202`로 접수하지만 일치하는 워크플로가 없으므로 Activity 실행을 만들면
   안 됩니다. 인증용 헤더는 워크플로 입력으로 전달되지 않습니다. Webhook
   설정에서 중지를 누른 뒤 같은 요청이 연결 오류가 되는지도 확인합니다.

수동 발신 도구는 실수로 외부 서비스에 요청하지 않도록 loopback URL만
허용합니다. ngrok 같은 공개 터널은 제품의 `터널 URL` 참고란에 기록할 수
있지만, 터널 생성·관리 자체는 이 도구의 책임이 아닙니다. 수신기가
리다이렉트를 반환하면 대상 주소를 따라가지 않고 해당 전송을 실패 처리합니다.
