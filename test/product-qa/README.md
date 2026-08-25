# AX Studio Product QA Harness

실제 Electron 앱으로 **지금 구현된 제품이 할 수 있는지**를 찾고, 결함을 수치로 기록합니다.

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
| `handwritten` (기본) | 수동 JSON만 | 4개 |
| `smoke` | 업무/승인/활동/설정 화면이 열리는지 | ~20 |
| `core` | 구현된 Gmail/Slack/DB/폴더/문서/워크플로/명령을 할 수 있는지 | ~80–150 |
| `full` | 설정↔채팅↔활동 같은 실제 사용 경로 | 수백 |
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
- coverage: product-ready surface 중 시나리오가 덮은 비율

기본은 결함을 **기록만** 하고 Playwright는 통과합니다. `--strict`면 check 실패가 fail입니다.

## 시나리오를 직접 추가

`test/product-qa/scenarios/*.json` + `manifest.json`. 생성기는 `covers`로 카탈로그 id를 표시합니다.
