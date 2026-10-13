# 판단 엔진 비교: Jev vs Codex CLI (LLM)

- 측정일: 2026-10-13 ~ 2026-10-14
- 질문: AX Studio의 요청 판단(어떤 경로·도구·자료·값으로 처리할지)을 판단 모델 Jev가 할 때와 LLM(Codex CLI)이 할 때, 정확도·일관성·속도·토큰·비용이 어떻게 다른가?
- 원본 결과: [`jev-vs-codex-decision-runs/`](jev-vs-codex-decision-runs/) (실행 24개 + 재시도 4개 파일), 집계: [`jev-vs-codex-decision-results.json`](jev-vs-codex-decision-results.json)

## 요약

| | Jev | gpt-5.6-luna | gpt-6-luna | gpt-6.1-sol low | gpt-6.1-sol medium | gpt-6.1-sol high |
|---|---|---|---|---|---|---|
| 전체 정확도 (73건 × 3회) | 94.1% | 94.1% | 90.9% | **97.3%** | **97.3%** | 96.8% |
| 기존 세트 49건 | **100%** | 95.2% | 90.5% | **100%** | **100%** | 99.3% |
| 새(홀드아웃) 세트 24건 | 81.9% | **91.7%** | **91.7%** | **91.7%** | **91.7%** | **91.7%** |
| 엉뚱한 실행 결정 (219건 중) | 6 | 9 | 16 | **0** | **0** | 1 |
| 3회 모두 같은 결정 | **93.2%** | 87.7% | 89.0% | **93.2%** | **93.2%** | 90.4% |
| 요청 1건 판단 시간 (p50) | **0.44초** | 14.2초 | 16.3초 | 39.4초 | 40.6초 | 48.0초 |
| 요청 1건 판단 시간 (p95) | **0.74초** | 44.1초 | 40.0초 | 90.8초 | 87.9초 | 85.0초 |
| 요청 1000건 비용 (공식 API 가격) | **$0.88** | $6.18 | $3.09 | $66.35 | $67.74 | $70.64 |
| 첫 시도 서비스 실패 | **0%** | **0%** | **0%** | 1.8% | 1.4% | 1.8% |

- **속도와 비용은 Jev가 압도적입니다.**
  - 속도: 가장 빠른 LLM보다 32배, 가장 정확한 LLM보다 90배 빠릅니다.
  - 비용: 가장 싼 LLM보다 3.5배, 가장 정확한 LLM보다 76배 쌉니다.
- **처음 보는 표현에는 Jev가 약합니다.**
  - 기존 세트는 Jev가 틀렸던 사례로 만들어 고친 세트라 100%가 나옵니다.
  - 새 세트에서는 81.9%로, 모든 Codex 설정(91.7%)보다 낮습니다.
  - 원인은 "고객"이나 "상품"을 물었는데 매번 `orders` 테이블을 고르는 쏠림입니다(아래 실패 분석 참고).
- **판단 품질만 보면 gpt-6.1-sol이 가장 좋습니다.** 정확도 97.3%에 엉뚱한 실행이 0건입니다. 다만 요청 하나에 40초 안팎이 걸리고 비용이 Jev의 76배라, 대화 중 실시간 판단에는 쓰기 어렵습니다.
- **luna 계열은 위험한 쪽으로 틀립니다.** 자료가 두 곳에 있어 사용자에게 되물어야 하는 경우에도 한쪽을 골라 바로 실행 결정을 냅니다. 엉뚱한 실행 결정이 9~16건입니다.
- **추론 강도(low/medium/high)를 올려도 정확도는 오르지 않았습니다.** 시간과 비용만 늘었습니다.

## 무엇을 비교했나

### 엔진

| 설정 | 엔진 | 모델 | 추론 강도 | 넣은 이유 |
|---|---|---|---|---|
| Jev | TypeSafe System One API | jev-1.13.0 | – | 지금 AX Studio의 판단 엔진 |
| 5.6-luna | Codex CLI 0.159.1 | gpt-5.6-luna | low | 지금 앱에 설정된 대화 모델 |
| 6-luna | Codex CLI 0.159.1 | gpt-6-luna | low | 최신 "빠르고 싼" 모델 |
| 6.1-sol low/medium/high | Codex CLI 0.159.1 | gpt-6.1-sol | low / medium / high | 최신 주력 모델과 추론 강도별 차이 |

Codex는 앱이 Codex를 부르는 방식 그대로 실행했습니다.
- `codex exec --json --ignore-user-config -s read-only --ephemeral`, 도구 기능 꺼짐, 짧은 기본 지시문(`model_instructions_file`), `--output-schema`로 답 형식 고정
- 개인 설정(`~/.codex/config.toml`의 모델, priority 등급)은 쓰지 않았습니다. 처리 등급은 표준입니다.

### 공정성: 같은 입력, 같은 앞뒤 코드

- 앱의 판단 라우터(`routeChatWithJev`)는 그대로 두고, 판단을 내리는 `decisionEngine.evaluate`만 바꿨습니다.
- 두 엔진은 똑같은 `state`와 `questions`를 받습니다.
  - `state`: 요청, 요청 특징, 맥락, 후보 정책
  - `questions`: 경로 선택, 후보 도구마다의 필요 여부, 표 변환 방식, 값 선택 등
- 후보 목록을 만드는 코드, 기준 확률(0.5 등), 명령을 조립하는 코드, 채점 함수(`routingMiss`)도 모두 같습니다.
- Codex의 답은 Jev와 같은 형식으로 바꿨습니다([`codex-decision-engine.ts`](../../packages/core/src/intelligence/commands/chat/routing/eval/codex-decision-engine.ts)).
  - 예/아니오 질문은 `probability`(0~1)로 받습니다.
  - 고르기 질문은 `choice`와 `confidence`를 받고, 선택지의 확률을 confidence로 둡니다.
  - Codex에 준 시스템 지시문은 이 파일의 `CODEX_DECISION_SYSTEM`에 그대로 있습니다.
- 조회나 발송은 실제로 하지 않았습니다. 무엇을 골랐는지만 채점했습니다.

### 케이스 (73건)

**연결 환경 2가지 (모두 가짜 메타데이터)**
- **basic**
  - 연결: 쇼핑몰 DB(orders/customers/products), DummyJSON API(products/carts/users), Gmail, Slack
  - 요청 1건당 판단 질문은 약 28개입니다.
- **scale**
  - 연결: DB 9개(테이블 약 55개, 이 중 ERP 약어 테이블 8개), API 25개, Gmail, Slack, 폴더 3개
  - orders·customers·users처럼 같은 이름이 여러 곳에 있습니다.
  - 요청 1건당 판단 질문은 약 174개입니다.

**두 세트**

| 세트 | 건수 | 설명 |
|---|---|---|
| 기존 세트 basic | 20 | [`routing-eval.cases.ts`](../../packages/core/src/intelligence/commands/chat/routing/eval/routing-eval.cases.ts)의 `JEV_ROUTING_CASES`. 매일 도는 Jev 평가 세트 |
| 기존 세트 scale | 29 | 같은 파일의 `JEV_SCALE_ROUTING_CASES` |
| 홀드아웃 basic | 14 | [`routing-eval.holdout-cases.ts`](../../packages/core/src/intelligence/commands/chat/routing/eval/routing-eval.holdout-cases.ts). 어느 엔진도 돌리기 전에 작성했고, 결과를 본 뒤 고치지 않음 |
| 홀드아웃 scale | 10 | 같은 파일 |

**기존 세트에는 Jev 쪽 편향이 있습니다.** 이 세트는 "Jev가 틀린 실제 사례를 케이스로 추가하고 앱 코드를 고쳐서 통과시킨다"는 방식으로 자랐습니다. 그래서 Jev 100%는 그만큼 맞춰진 결과입니다. 처음 보는 요청에 대한 실력은 홀드아웃 세트로 봐야 합니다.

### 반복과 재시도

- 설정마다 73건을 3회 반복했습니다. 판정은 6 × 73 × 3 = 1,314건입니다.
- 첫 시도 서비스 실패는 11건이었고, 모두 gpt-6.1-sol에서 `Selected model is at capacity`(모델 용량 부족)였습니다.
  - 해당 케이스만 한 번 다시 실행했고, 11건 모두 성공했습니다.
  - 정확도는 재시도를 반영한 값이고, 첫 시도 수치는 따로 적었습니다.
- 고정 비용은 요청 내용과 무관한 "한 문장, 질문 1개" 호출을 설정마다 5번 보내 측정했습니다.

## 결과

### 정확도 (3회 평균, 괄호는 최저~최고)

| 설정 | 전체 | 기존 | 홀드아웃 | 기존 basic | 기존 scale | 홀드아웃 basic | 홀드아웃 scale |
|---|---|---|---|---|---|---|---|
| Jev | 94.1% (93.2–94.5) | 100% | 81.9% (79.2–83.3) | 100% | 100% | 71.4% | 96.7% (90.0–100) |
| 5.6-luna low | 94.1% (93.2–94.5) | 95.2% (93.9–95.9) | 91.7% | 100% | 92.0% (89.7–93.1) | 92.9% | 90.0% |
| 6-luna low | 90.9% (90.4–91.8) | 90.5% (89.8–91.8) | 91.7% | 95.0% | 87.4% (86.2–89.7) | 92.9% | 90.0% |
| 6.1-sol low | 97.3% | 100% | 91.7% | 100% | 100% | 85.7% | 100% |
| 6.1-sol medium | 97.3% | 100% | 91.7% | 100% | 100% | 85.7% | 100% |
| 6.1-sol high | 96.8% (95.9–97.3) | 99.3% (98.0–100) | 91.7% | 100% | 98.9% (96.6–100) | 85.7% | 100% |

홀드아웃은 24건이라 1건이 4.2%p입니다. Jev와 Codex의 홀드아웃 차이(81.9% vs 91.7%)는 대략 2~3건 차이입니다.

### 틀린 방식

| 설정 | 틀린 판정 (219건 중) | 엉뚱한 실행 결정 | 되묻기·거절 | 값 입력 요청 | 서비스 실패 (재시도 후) |
|---|---|---|---|---|---|
| Jev | 13 | 6 | 4 | 3 | 0 |
| 5.6-luna low | 13 | 9 | 1 | 3 | 0 |
| 6-luna low | 20 | 16 | 1 | 3 | 0 |
| 6.1-sol low | 6 | 0 | 3 | 3 | 0 |
| 6.1-sol medium | 6 | 0 | 3 | 3 | 0 |
| 6.1-sol high | 7 | 1 | 3 | 3 | 0 |

- "엉뚱한 실행 결정"은 다른 자료를 읽거나 되물어야 할 때 바로 실행하는 결정입니다. 이번 케이스는 모두 조회라 실제 피해는 없지만, 업무 도구에서는 가장 위험한 쪽입니다.
- "되묻기·거절"은 실행하지 않고 멈춘 경우라 안전한 실패입니다.
- "값 입력 요청"은 `h-slack-search` 한 케이스에서 나왔습니다. 모든 엔진이 3회씩 틀렸습니다(아래 참고).

### 일관성 (같은 요청 3회)

| 설정 | 3회 모두 같은 결정 | 3회 모두 같은 정답 여부 | 1~2회만 맞은 케이스 |
|---|---|---|---|
| Jev | 93.2% | 98.6% | hs-unpaid-invoices |
| 5.6-luna low | 87.7% | 98.6% | scale-ambiguous-orders |
| 6-luna low | 89.0% | 95.9% | scale-logistics-orders, scale-ambiguous-orders, scale-remembered-orders |
| 6.1-sol low | 93.2% | 100% | 없음 |
| 6.1-sol medium | 93.2% | 100% | 없음 |
| 6.1-sol high | 90.4% | 98.6% | scale-folder |

"같은 결정"은 결과 종류, 경로, 고른 도구와 값까지 모두 같다는 뜻입니다. 정답이어도 값 하나만 다르면 다른 결정으로 셉니다.

### 속도

| 설정 | 요청 p50 | 요청 p95 | 요청 평균 | 최대 | basic p50 | scale p50 | 호출 1번 p50 | 호출 1번 p95 |
|---|---|---|---|---|---|---|---|---|
| Jev | 0.44초 | 0.74초 | 0.43초 | 1.4초 | 0.24초 | 0.52초 | 0.24초 | 0.34초 |
| 5.6-luna low | 14.2초 | 44.1초 | 19.1초 | 141초 | 10.3초 | 16.1초 | 11.4초 | 42.8초 |
| 6-luna low | 16.3초 | 40.0초 | 19.2초 | 142초 | 9.5초 | 18.5초 | 12.0초 | 37.1초 |
| 6.1-sol low | 39.4초 | 90.8초 | 38.0초 | 143초 | 16.8초 | 43.8초 | 17.1초 | 82.5초 |
| 6.1-sol medium | 40.6초 | 87.9초 | 37.6초 | 97초 | 17.7초 | 43.6초 | 18.9초 | 58.3초 |
| 6.1-sol high | 48.0초 | 85.0초 | 46.3초 | 135초 | 20.3초 | 60.2초 | 22.6초 | 81.8초 |

- 요청 하나에는 판단 호출이 1~7번 들어갑니다(평균은 아래 토큰 표).
- 반복 업무 만들기처럼 단계가 많은 요청이 가장 느립니다. Codex로는 1~2분 걸렸습니다.

### 토큰 (요청 1건 평균)

| 설정 | 판단 호출 | 실제 HTTP 요청 | 요청 크기 | 입력 토큰 | 그중 캐시 | 출력 토큰 | 그중 reasoning |
|---|---|---|---|---|---|---|---|
| Jev | 1.65 | 2.18 | 63.0 KB | 20,829 | 0 | 2,638 | – |
| 5.6-luna low | 1.32 | 1.32 | 53.4 KB | 26,475 | 3,378 | 1,243 | 130 |
| 6-luna low | 1.26 | 1.26 | 53.3 KB | 28,696 | 3,333 | 1,044 | 0 |
| 6.1-sol low | 1.33 | 1.33 | 53.7 KB | 29,432 | 1,570 | 1,047 | 26 |
| 6.1-sol medium | 1.33 | 1.33 | 53.7 KB | 29,493 | 1,235 | 1,110 | 59 |
| 6.1-sol high | 1.33 | 1.33 | 53.7 KB | 29,372 | 1,659 | 1,505 | 183 |

- **Jev의 실제 HTTP 요청이 더 많은 이유:** Jev는 64KB가 넘는 요청을 나눠 보내기 때문입니다. 나눌 때마다 `state`를 다시 보내서 요청 크기도 더 큽니다.
- **그런데도 Jev 입력 토큰이 더 적은 이유:** Codex CLI가 호출마다 자체 지시문을 붙이기 때문입니다. 아래 고정 비용 표를 보면 호출 1번에 약 8.5~10.6k 토큰입니다.
- **reasoning 토큰:** Codex가 보고한 reasoning 토큰은 모든 호출에서 출력 토큰 안에 포함돼 있었습니다(reasoning > output인 호출 0건). 그래서 비용은 출력 토큰만으로 계산했습니다.
- **Jev 출력 토큰:** 질문마다 확률을 돌려주느라 출력이 많지만, Jev는 출력이 무료입니다.

### 비용 (공식 API 가격 기준)

가격은 Standard 등급, 100만 토큰당 가격이고 2026-10-13에 확인했습니다.

| 모델 | 입력 | 캐시 입력 | 출력 | 출처 |
|---|---|---|---|---|
| jev-1.13.0 | $0.042 | – | 무료 | docs.typesafe.ai/models.md, typesafe.ai |
| gpt-5.6-luna | $0.20 | $0.02 | $1.20 | developers.openai.com/api/docs/pricing |
| gpt-6-luna | $0.10 | $0.01 | $0.50 | 〃 |
| gpt-6.1-sol | $2.00 | $0.10 | $10.00 | 〃 |

- OpenAI는 reasoning 토큰을 출력으로 청구합니다(developers.openai.com/api/docs/guides/reasoning).
- TypeSafe에는 요청 단위나 질문 단위 요금이 없습니다.

| 설정 | 요청 1건 | 요청 1000건 | 이번 측정 전체 (219건) |
|---|---|---|---|
| Jev | $0.00087 | $0.88 | $0.19 |
| 5.6-luna low | $0.00618 | $6.18 | $1.35 |
| 6-luna low | $0.00309 | $3.09 | $0.68 |
| 6.1-sol low | $0.06635 | $66.35 | $14.53 |
| 6.1-sol medium | $0.06774 | $67.74 | $14.83 |
| 6.1-sol high | $0.07064 | $70.64 | $15.47 |

Codex CLI를 ChatGPT 로그인으로 쓰면 토큰 단위로 청구되지 않고 구독 사용량이 줄어듭니다. 위 Codex 비용은 같은 토큰을 API로 썼을 때의 환산값입니다.

### 고정 비용 (한 문장, 질문 1개 호출 5회 평균)

| 설정 | 시간 | 입력 토큰 | 출력 토큰 | 호출 1번 비용 |
|---|---|---|---|---|
| Jev | 0.23초 | 280 | 22 | $0.0000118 |
| 5.6-luna low | 5.5초 | 8,454 | 39 | $0.00174 |
| 6-luna low | 6.0초 | 10,554 (캐시 1,997) | 19 | $0.00089 |
| 6.1-sol low | 6.8초 | 10,555 | 19 | $0.02130 |
| 6.1-sol medium | 6.5초 | 10,555 | 19 | $0.02130 |
| 6.1-sol high | 7.0초 | 10,554 | 35 | $0.02145 |

Codex는 질문이 하나뿐이어도 호출 한 번에 5~7초와 약 1만 토큰이 듭니다. CLI 프로세스를 띄우는 시간과 Codex 자체 지시문 때문입니다. 판단 호출이 여러 번 필요한 요청일수록 이 차이가 커집니다.

### 서비스 안정성 (첫 시도)

| 설정 | 첫 시도 정확도 | 서비스 실패 케이스 | 실패한 호출 비율 | 원인 |
|---|---|---|---|---|
| Jev | 94.1% | 0 | 0% | – |
| 5.6-luna low | 94.1% | 0 | 0% | – |
| 6-luna low | 90.9% | 0 | 0% | – |
| 6.1-sol low | 95.9% | 4 (1.8%) | 1.4% | 원인 미기록 (에러 기록 수정 전) |
| 6.1-sol medium | 95.9% | 3 (1.4%) | 1.0% | 원인 미기록 (에러 기록 수정 전) |
| 6.1-sol high | 95.0% | 4 (1.8%) | 1.7% | `Selected model is at capacity` |

- 6.1-sol low/medium의 run1은 Codex 에러 메시지를 남기기 전에 돌았습니다. 하지만 같은 증상(토큰 0, 5~13초 안에 실패)이고, 재시도에서 모두 성공했습니다.
- Jev 연결 코드는 일시 오류(429/503 등)를 자동으로 재시도합니다. 앱의 Codex 연결 코드에는 재시도가 없습니다.

## 실패 분석

### Jev가 홀드아웃에서 틀린 것

| 케이스 | 요청 | 결과 (3회) | 원인 |
|---|---|---|---|
| h-db-busan-customers | 쇼핑몰 DB 고객 중에 부산 고객만 보여줘 | 0/3 | `orders`를 기준 테이블로 잡고 customers·products를 붙임 |
| h-db-products | DB에 있는 상품 목록 보여줘 | 0/3 | 같은 증상: `orders` + join |
| h-follow-sum | 방금 표에서 금액 합계 얼마야? | 0/3 | 도구도 답도 고르지 않음 (`uncertain`) |
| hs-unpaid-invoices | 아직 돈 안 들어온 청구서 보여줘 | 2/3 | 1회는 4곳(쇼핑몰·회계·ERP DB, ERP API)을 두고 되물음 (안전한 실패) |
| h-slack-search | 슬랙에서 배포 얘기 나온 메시지 찾아줘 | 0/3 | 모든 엔진 공통 (아래) |

- **Jev의 `orders` 쏠림.** 기존 세트의 DB 케이스가 거의 전부 주문(orders) 질문이라, Jev도 그 주변 앱 코드도 주문 기준으로만 검증돼 있었습니다. Codex는 6개 설정 모두 이 두 케이스를 3/3으로 맞혔습니다.
- **h-follow-sum.** 이전 표의 합계를 묻는 후속 질문입니다. Jev와 6.1-sol 세 설정은 모두 실패했고, luna 두 설정만 맞혔습니다. 이전 표를 다루는 경로가 이 표현에서는 잘 잡히지 않는 것으로 보입니다.

### Codex luna 계열이 틀린 것

| 케이스 | 정답 | luna의 결정 |
|---|---|---|
| hs-ambiguous-customers (고객 목록 보여줘) | 쇼핑몰 DB와 CRM DB 중에 되묻기 | 쇼핑몰 DB customers를 바로 조회 (두 모델 모두 3/3) |
| scale-erp-vendors (ERP에서 매입처 목록) | ERP DB와 ERP API 중에 되묻기 | ERP DB를 바로 조회 (3/3) |
| scale-ambiguous-orders (주문 목록 보여줘) | 되묻기 | 한 곳을 바로 조회 (1/3) |
| two-sources (화장품 상품 찾아줘) | 되묻기 | 6-luna가 DummyJSON을 바로 조회 (3/3) |
| scale-remembered-similar / -orders | 지난번 사용자가 고른 물류 DB | 쇼핑몰 DB나 주문 API를 고름 |
| scale-logistics-orders (물류 쪽 주문 목록) | 물류 DB orders | 6-luna가 주문 API를 고름 (2/3) |

정리하면 luna 계열은 **자료가 여러 곳에 있을 때 되묻지 않고 한쪽을 골라 버리는** 경향이 있습니다. 엉뚱한 실행 결정이 9~16건인 것도 대부분 이 경우입니다. 6.1-sol은 이 경우들을 모두 맞혔습니다.

### 모든 엔진이 틀린 것: h-slack-search

"슬랙에서 배포 얘기 나온 메시지 찾아줘"에서는 6개 설정 모두 검색어를 사용자에게 다시 물었습니다(`parameterized`).
- 원인은 엔진이 아니라 앱 쪽입니다. 요청 문장에서 검색어("배포")를 채우지 않고 입력을 요청합니다.
- 홀드아웃은 고치지 않는다는 원칙에 따라 기대값은 작성한 그대로 두었습니다.

## 해석과 한계

- **기존 세트 편향:** 기존 세트는 Jev에 맞춰진 세트입니다. 처음 보는 표현에 대한 비교는 홀드아웃 24건뿐이라 표본이 작습니다. 홀드아웃을 늘리면 차이가 더 정확해집니다.
- **비교 대상은 "앱이 쓰는 Codex CLI":** 모델을 API로 바로 부르는 경우와는 다릅니다. CLI를 쓰면 프로세스 시작과 자체 지시문 때문에 호출마다 5~7초와 약 1만 토큰이 더 듭니다. API로 직접 부르면 Codex 쪽 시간과 비용이 줄어듭니다.
- **기준 확률은 Jev에 맞춰져 있습니다:** 기준 확률(0.5, 0.3 등)과 판단 질문 형식은 Jev의 확률을 보고 정한 것입니다. Codex의 확률은 모델이 스스로 말한 확신도라, 같은 기준에서 Jev와 성격이 다릅니다.
- **동시 실행의 영향:** 5.6-luna run1, 6-luna run1, 6.1-sol low run1의 앞부분은 세 실행을 동시에 돌린 상태에서 쟀습니다. 메모리 부족으로 중단된 뒤 나머지는 하나씩 돌렸습니다.
- **추론 강도:** 6.1-sol의 low와 medium은 정확도가 같았고, high는 조금 낮고 더 느렸습니다. 이번 판단 작업에서는 추론 강도를 올려도 이득이 없었습니다.

## 다음 할 일 후보

1. **Jev의 `orders` 쏠림:** 홀드아웃 두 건(고객 조회, 상품 목록)을 기존 세트에 넣지 말고, 같은 종류의 새 케이스로 원인을 고칩니다. 홀드아웃은 그대로 남겨 둬야 계속 검증에 쓸 수 있습니다.
2. **홀드아웃 확대:** 24건을 50건 이상으로 늘려 처음 보는 표현에 대한 정확도의 오차를 줄입니다.
3. **Slack 검색어:** "배포 얘기"처럼 요청 안에 있는 검색어를 바로 쓰도록 고칩니다.
4. **Codex 재시도(선택):** 앱의 Codex 연결 코드에 용량 부족(`at capacity`) 재시도를 넣을지 검토합니다.

## 다시 돌리는 법

```bash
cd packages/core
# 엔진 하나, 1회 (JEV_API_KEY 또는 TYPESAFE_API_KEY 필요)
AX_LIVE_DECISION_COMPARE=1 AX_COMPARE_ENGINE=jev AX_COMPARE_RUN=1 AX_COMPARE_OUT=<dir> \
  npx vitest run src/intelligence/commands/chat/routing/eval/decision-compare.live.test.ts
# Codex: AX_COMPARE_ENGINE=codex:<model>:<low|medium|high>
# 고정 비용: AX_COMPARE_OVERHEAD=1 AX_COMPARE_ONLY=none ... -t "fixed overhead"
# 서비스 실패만 다시: AX_COMPARE_ONLY=<id,...> AX_COMPARE_RUN=<n>-retry
node scripts/decision-compare-report.mjs <dir> <out.json>
```

## 부록: 케이스별 결과 (재시도 반영, 3회 중 맞힌 횟수)

| 세트 | 케이스 | 요청 | Jev | 5.6-luna | 6-luna | 6.1-sol low | 6.1-sol med | 6.1-sol high |
|---|---|---|---|---|---|---|---|---|
| main/basic | greeting | 안녕 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/basic | capabilities | 너는 뭘 할 수 있어? | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/basic | db-orders | 쇼핑몰 DB에서 주문 목록 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/basic | db-region-sum | 지역별 매출 합계 알려줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/basic | db-category-sum | 상품 카테고리별 매출 합계 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/basic | db-multi-filter | 완료된 주문 중에 5만원 넘는 것만 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/basic | db-top-amount | 주문 금액이 가장 큰 5건 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/basic | api-products | DummyJSON에서 상품 5개 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/basic | api-top-rated | DummyJSON 상품 중 평점 높은 순으로 10개 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/basic | two-sources | 화장품 상품 찾아줘 | 3/3 | 3/3 | 0/3 | 3/3 | 3/3 | 3/3 |
| main/basic | gmail-recent | 최근 메일 5개 제목만 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/basic | slack-channels | 슬랙 채널 목록 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/basic | connections | 연결된 데이터 뭐 있어? | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/basic | works | 내 업무 목록 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/basic | report-from-last-month | 지난달 보고서야. 이번 달 걸로 써 줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/basic | recurring-report | 매주 월요일 9시에 지역별 매출 합계를 슬랙 #ax테스트로 보내줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/basic | mail-trigger | Gmail로 새 메일이 오면 요약해서 슬랙으로 알려주는 업무 만들어줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/basic | remember | 앞으로 이 대화에서는 금액을 만원 단위로 말해줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/basic | follow-sort | 방금 결과를 금액 높은 순으로 정렬해줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/basic | follow-filter | 거기서 서울만 남겨줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-greeting | 안녕하세요 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-leave-balance | 직원별 남은 연차 일수 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-delay-reasons | 배송 지연 사유별로 몇 건인지 알려줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-shop-paid | 쇼핑몰 주문 중에 결제 완료된 것만 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-logistics-orders | 물류 쪽 주문 목록 보여줘 | 3/3 | 3/3 | 1/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-ambiguous-orders | 주문 목록 보여줘 | 3/3 | 2/3 | 2/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-crm-deals | CRM에서 진행 중인 거래 금액 합계 알려줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-urgent-tickets | 고객지원 티켓 중에 우선순위 높은 것만 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-payroll | 이번 달 부서별 급여 합계 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-fx | 환율 API에서 달러 환율 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-weather | 오늘 날씨 어때? | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-github-issues | GitHub 이슈 목록 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-jira-issues | Jira 이슈 목록 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-dummy-users | DummyJSON 사용자 목록 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-placeholder-users | JSONPlaceholder에서 사용자 목록 가져와 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-low-stock | 재고 부족한 상품 알려줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-mail | 최근 메일 5개 제목만 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-slack | 슬랙 채널 목록 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-folder | 월간보고 폴더에 어떤 파일 있어? | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 2/3 |
| main/scale | scale-works | 내 업무 목록 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-erp-vendors | ERP에서 매입처 목록 보여줘 | 3/3 | 0/3 | 0/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-erp-warehouse | 창고 입출고 이력 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-erp-warranty | 보증수리 청구 들어온 거 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-erp-freight | 지역별 운임표 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-erp-certs | 직원들 자격증 만료일 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-remembered-orders | 주문 목록 보여줘 | 3/3 | 3/3 | 1/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-remembered-similar | 이번 주 들어온 주문 몇 건이야? | 3/3 | 0/3 | 0/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-remembered-unrelated | 직원별 남은 연차 일수 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| main/scale | scale-recurring | 매주 월요일 9시에 지역별 매출 합계를 슬랙으로 보내줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| holdout/basic | h-thanks | 고마워! | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| holdout/basic | h-howto | 업무를 자동으로 돌리려면 어떻게 해야 돼? | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| holdout/basic | h-db-busan-customers | 쇼핑몰 DB 고객 중에 부산 고객만 보여줘 | 0/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| holdout/basic | h-db-status-count | 주문 상태별로 몇 건인지 알려줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| holdout/basic | h-db-average | 평균 주문 금액 얼마야? | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| holdout/basic | h-db-products | DB에 있는 상품 목록 보여줘 | 0/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| holdout/basic | h-api-carts | DummyJSON 장바구니 목록 가져와 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| holdout/basic | h-api-users | DummyJSON 사용자 10명 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| holdout/basic | h-mail-search | 배송 관련 메일 찾아줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| holdout/basic | h-slack-search | 슬랙에서 배포 얘기 나온 메시지 찾아줘 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 | 0/3 |
| holdout/basic | h-slack-send | #ax테스트에 회의 10분 늦는다고 보내줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| holdout/basic | h-follow-sum | 방금 표에서 금액 합계 얼마야? | 0/3 | 3/3 | 3/3 | 0/3 | 0/3 | 0/3 |
| holdout/basic | h-daily-job | 매일 아침 8시에 어제 주문 건수를 슬랙 #ax테스트로 보내줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| holdout/basic | h-works | 지금 만들어 둔 업무 뭐 있어? | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| holdout/scale | hs-employees | 인사 DB 직원 목록 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| holdout/scale | hs-github-pulls | GitHub 풀 리퀘스트 목록 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| holdout/scale | hs-unpaid-invoices | 아직 돈 안 들어온 청구서 보여줘 | 2/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| holdout/scale | hs-ad-spend | 마케팅 DB에서 캠페인별 광고비 합계 알려줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| holdout/scale | hs-holidays | 올해 공휴일 알려줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| holdout/scale | hs-survey-average | 고객지원 만족도 점수 평균 알려줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| holdout/scale | hs-suppliers | 재고 DB 공급업체 목록 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| holdout/scale | hs-hr-folder | 인사규정 폴더에 뭐 있어? | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
| holdout/scale | hs-ambiguous-customers | 고객 목록 보여줘 | 3/3 | 0/3 | 0/3 | 3/3 | 3/3 | 3/3 |
| holdout/scale | hs-coin | 비트코인 시세 보여줘 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 | 3/3 |
