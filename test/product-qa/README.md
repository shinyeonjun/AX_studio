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

실패로 Playwright 작업자가 재시작되어도 `report-parts/`의 작업자별 기록을 합쳐 이전 실패를 보존합니다. 현재 설정은 `workers: 1`이며 같은 작업자의 누적 보고서를 갱신해도 중복 집계하지 않습니다. 이 보고서는 JSON/생성 시나리오 집계이고, 별도 `.spec.ts` 검사의 최종 성공 여부는 Playwright 결과와 프로세스 종료 코드로 확인합니다.

승인·취소 클릭은 최대 15초 안에 해당 카드가 실제로 사라져야 완료됩니다. 클릭 이벤트 직후의 순간 상태만으로 판정하지 않으며, 카드가 계속 남으면 여전히 실패합니다.

기본은 결함을 **기록만** 하고 Playwright는 통과합니다. `--strict`면 check 실패가 fail입니다.

## 시나리오를 직접 추가

`test/product-qa/scenarios/*.json` + `manifest.json`. 생성기는 `covers`로 카탈로그 id를 표시합니다.

## 실제 엔진으로 검증하는 출시 경로

`discovery-execution.spec.ts`는 자료 폴더 연결 → CSV 분석 → 업무 저장 → 원본 갱신 →
수동 실행 → 계산 값 표시 → 재시작 후 복원 → 입력 열 변경 거부를 검사합니다.
`gmail-client-setup.spec.ts`는 Windows OS 암호화 저장, 잘못된 OAuth JSON 거부,
재시작과 손상된 설정 복구를 검사합니다. Google 로그인이나 실제 메일 발송은 하지 않습니다.

두 검사는 `realEngines: true`로 fake agent/document engine 환경 변수를 제거합니다.
네이티브 파일 선택 대화상자만 테스트 자료를 선택하도록 대체하고, IPC·발견·컴파일·실행·저장·화면은
실제 구현을 사용합니다. 사용자 프로필과 분리된 임시 데이터만 사용합니다.
`npm run typecheck:tests`는 제품 검사 코드와 실제 앱 API의 타입 일치도 검사합니다.
Windows 출시 검사와 CI는 이 경로를 빌드된 설치본 실행 파일에서도 반복합니다.
