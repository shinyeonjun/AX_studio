# AX Studio Product QA Harness

실제 Electron 앱의 화면·세션·승인 흐름을 실행하고, 시나리오에 명시된 검사의 결과를 기록합니다. 답변 존재 여부만 검사하는 시나리오는 해당 업무의 정확성을 증명하지 않습니다.

JSON 시나리오를 손으로 수천 개 쓰지 않습니다. `catalog/product-surface.ts`에 구현된 기능 목록이 있고, `--tier`가 그 목록에서 시나리오를 생성합니다.

## 빠른 시작

```bash
npm run build -w @ax-studio/desktop

# 구현된 기능 목록
npm run test:product-qa -- --list-catalog

# 시나리오가 몇 개 나오는지
npm run test:product-qa -- --mode deterministic --tier core --count
npm run test:product-qa -- --mode deterministic --tier soak --max 10000 --count

# 화면 탐색 (fake agent, 빠름)
npm run test:product-qa -- --mode deterministic --tier smoke

# 제품이 capability/command를 할 수 있는지 (실제 AI, 실제 데이터)
npm run test:product-qa -- --tier core

# 수천 번 무작위 사용 경로
npm run test:product-qa -- --mode deterministic --tier soak --max 2000
```

## 티어

| 티어 | 무엇을 판단하나 | 규모 |
|------|----------------|------|
| `handwritten` (기본) | 수동 JSON만 | 모드별 상이, `--count` 확인 |
| `smoke` | 업무/승인/활동/설정 화면이 열리는지 | ~20 |
| `core` | 기능 관련 질문의 응답·세션·문서 첨부 검사. 실제 업무 수행 판정은 별도 검증 필요 | `--count` 확인 |
| `full` | 설정↔채팅↔활동 같은 사용 경로 조합 | `--count` 확인 |
| `soak` | 무작위 클릭/전송 조합. `--max`로 수천~만 | 기본 10000 |

`live` core는 실제 AI 호출입니다. 메일/슬랙 **발송**은 기본적으로 빼고, `--allow-side-effects`일 때만 넣습니다.

## 모드

| 모드 | 설명 |
|------|------|
| `live` (기본) | 실제 AI + 실제 `%LOCALAPPDATA%/AXStudio`. 앱 창을 닫고 실행. |
| `deterministic` | fake agent. UI/세션/화면 결함 대량 탐색용. |

## 리포트

`test/product-qa/runs/<runId>/report.md`

- pass/fail, defect 수, critical, reply latency
- coverage: 완료 후 통과한 시나리오가 선언한 기능 목록의 비율. 아직 실행하지 않았거나 실패한 시나리오는 제외합니다. 실제 기능 정확도나 AI 성공률과 다릅니다.

기본은 결함을 **기록만** 하고 Playwright는 통과합니다. `--strict`면 check 실패가 fail입니다.

## 시나리오를 직접 추가

`test/product-qa/scenarios/*.json` + `manifest.json`. 생성기는 `covers`로 카탈로그 id를 표시합니다.
