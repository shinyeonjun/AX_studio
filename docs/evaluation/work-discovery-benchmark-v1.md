# Work Discovery Benchmark v1

## 목적

이 benchmark는 제품 전체의 연결성이나 UI 완성도를 측정하지 않는다. 현재
Work Discovery의 제한된 table/numeric synthesis 경계에서 다음을 검증한다.

1. 과거 examples에서 source와 변환 후보를 찾는가
2. snapshot replay가 관찰된 결과를 재현하지 못하는 후보를 제거하는가
3. 여러 후보가 남으면 자동 확정하지 않고 clarification으로 멈추는가
4. 처음 보는 holdout example에서도 publish된 후보가 결과를 재현하는지
   평가하는가. holdout은 제품의 discovery/replay/publish 입력이 아니다.

Benchmark 코드는 저장소의 `test/work-discovery-benchmark`에 둔다. 생성된
fixture, snapshot, 실행 결과와 로그는 저장소 밖의 `D:\\ax\\_test`에 둔다.

## 데이터 계약

각 case는 다음 정보를 가진다.

- `examples`: 후보 생성과 training replay에 사용하는 과거 사례 3개
- `holdout`: 후보를 생성할 때 보지 않는 새로운 사례 2개
- `sources`: source descriptor와 source id
- `snapshots`: example/holdout별 table snapshot
- `observations`: 결과물에서 관찰된 숫자 필드
- `expected`: gold outcome, 허용 source, 허용 expression, holdout 기대값

`examples`만 제품 discovery에 제공되는 training evidence다. `holdout`은
benchmark runner가 discovery 결정을 끝낸 뒤에만 평가하는 숨겨진 평가 자료로
취급한다. 따라서 holdout 결과를 제품의 후보 생성, replay, ambiguity 판정,
publish 결정에 전달하지 않는다. 제품에 사용자가 직접 제공한 validation
example이나 cross-validation을 추가하는 것은 이 benchmark와 별도의 기능
설계 결정이다.

Gold answer는 실행기가 만든 결과에서 추출하지 않는다. fixture generator가
원본 행에서 별도로 계산하여 저장한다. 같은 결과를 만드는 동등한 표현이
있을 수 있으므로 정답은 단일 문자열이 아니라 허용 expression 집합으로
표현한다.

## Case 구성

v1은 10개 case template으로 시작한다.

| Case | 도메인 | 핵심 조건 | 기대 outcome |
|---|---|---|---|
| B01 | sales | 총매출 `SUM(amount)` | publish |
| B02 | sales | 주문 수 `COUNT(*)` | publish |
| B03 | sales | 평균 주문액 `AVG(amount)` | publish |
| B04 | sales | 목표 달성률 `SUM(actual) / SUM(target)` | publish |
| B05 | billing | null·중복이 포함된 청구액 합계 | publish |
| B06 | subscription | 구독 건수 | publish |
| B07 | support | 두 source가 같은 결과를 만드는 ambiguity | clarify |
| B08 | finance | training에서는 같지만 holdout에서 갈리는 source | clarify |
| B09 | sales | 통과하는 후보가 없는 no-match | no_match |
| B10 | billing | 잘린 snapshot에서 aggregate 시도 | no_match |

고정된 v1 세트만 반복 실행하면 살충제 패러독스가 생길 수 있으므로,
`rotating` 프로필은 v1의 의미를 바꾸지 않는 구조 변형 case를 추가한다.

| Case | 변형 | 기대 outcome |
|---|---|---|
| B11 | 행 순서와 불필요한 컬럼이 달라진 총매출 | publish |
| B12 | 값이 다른 보조 주문 원장이 함께 있는 평균 주문액 | publish |
| B13 | 숫자 표시 문자열과 불필요한 컬럼이 있는 목표 달성률 | publish |
| B14 | 추가 행이 있는 보조 구독 목록이 함께 있는 건수 | publish |

`rotating`은 seed에 따라 값이 달라지고, 위 변형을 포함해 14개 case를
실행한다. 원본 v1 10개는 회귀 기준으로 계속 보존하며, 회전 세트에서
발견된 실패는 숨기지 않고 제품 범위 확장 또는 fixture 계약 수정의 근거로
기록한다. 실행 시 생성되는 CSV는 입력 표현을 확인하기 위한 자료이고,
gold 결과는 별도로 계산된 `expected.json`에 저장한다.

숫자, 고객명, 주문 ID, 행 순서와 기간별 값은 seed로 생성한다. 따라서
실행기가 특정 숫자나 case id를 매핑하여 맞추는 방식은 통과할 수 없다.

## 비교 variant

### AX Full

benchmark에서 관찰하는 현재 구현의 전체 흐름이다. 마지막 holdout replay는
제품 흐름이 아니라 결정 후 평가 단계다.

```text
deterministic candidate enumeration
→ training replay
→ winner resolution
→ ambiguity detection
→ clarification 또는 publish
→ (benchmark 평가 전용) holdout replay
```

### AX - Replay

동일한 candidate enumeration을 사용하지만 replay 없이 simplicity만으로
최상위 후보를 publish한다. 후보 검증의 효과를 측정하기 위한 비교군이다.

### AX - Clarification

replay는 사용하지만 ambiguity를 감지해도 가장 높은 후보 하나를 자동
publish한다. 사람에게 질문하는 안전장치의 효과를 측정하기 위한 비교군이다.

Holdout은 variant가 아니라 모든 variant에 동일하게 적용하는 사후 평가
절차다. 숨겨진 holdout을 보고 discovery 결과를 다시 선택하거나 publish를
막지 않는다.

### 살충제 패러독스 대응

테스트를 한 번 통과한 고정 숫자나 case id에 매핑하는 구현을 방지하기 위해
다음 순서로 세트를 운영한다.

1. `v1`의 10개 골든 case와 기대 판정은 변경하지 않는다.
2. 다른 seed로 같은 계약을 재생성해 값, ID, 행 수를 바꾼다.
3. `rotating` 프로필로 행 순서, 잡음 컬럼, 보조 source, 표현 형식 변형을
   추가한다.
4. 실패한 변형은 실제 결함인지 잘못된 fixture인지 판별한 뒤, 원인과
   후속 조치를 실행 기록에 남긴다.
5. 제품 기능이 넓어지면 PDF/파일/DB 입력과 승인·실행 E2E를 별도 프로필로
   추가하며, 기존 골든 세트를 대체하지 않는다.

Seed 변경은 무작위성 자체가 아니라 재현 가능한 변화다. 모든 보고서에
seed와 profile을 기록하므로 같은 실패를 다시 재생할 수 있다.

## 확장 profile

고정 회귀 세트와 rotating 세트는 유지한 채, 아래 profile을 독립적으로
실행할 수 있다. 각 profile은 기본 10개에 네 가지 시나리오를 추가한다.

| Profile | 추가 범위 | 총 case |
|---|---|---:|
| `schema-drift` | 컬럼 rename, nullable 변화, 숫자 문자열, 컬럼 add/delete | 14 |
| `source-confusion` | 동일 backup, 유사 backup, primary 누락, 잘린 backup | 14 |
| `holdout` | source divergence, training overfit, holdout source 누락, 0 분모 | 14 |
| `input-variation` | CSV, XLSX sheet, PostgreSQL provenance, PDF 표 추출 provenance | 14 |
| `expanded` | rotating과 위 네 profile 전체 | 30 |

`holdout` profile의 B24~B26처럼 기대 outcome이 `no_match`인 사례는 training
evidence만으로 선택한 후보가 보지 못한 데이터에서 일반화되지 않는지 드러내는
negative evidence다. 이 실패를 제품이 holdout을 보지 않았다는 이유로 제품
버그라고 단정하지 않는다. 각 실패에는 discovery evidence, training replay,
ambiguity/publish 결정, hidden holdout 결과와 함께 다음 분류를 기록한다.

- `benchmark_specification_issue`: fixture 또는 gold 계약 자체의 문제
- `existing_product_bug`: discovery 시점에 관찰 가능한 기존 제품 계약 위반
- `algorithmic_limitation`: 제공된 evidence만으로 규칙을 유일하게 식별할 수
  없거나 일반화할 수 없는 한계
- `missing_product_capability`: 별도 제품 기능이 있어야 다룰 수 있는 운영·품질
  조건

B24~B26의 holdout mismatch는 현재 `algorithmic_limitation` 또는
`missing_product_capability`로 기록하며, 제품에 holdout gate를 추가하거나
gold를 바꾸는 근거로 사용하지 않는다. 실행 결과와 상세 evidence는 일반
report와 별도로 `runs/latest-failures.json` 및 `runs/latest-failures.md`에
보존한다.

## Gold 독립성

Gold는 Core의 `enumerateCandidates`, `replayCandidates` 또는
`evaluateTransformExpr`에서 생성하지 않는다. fixture builder가 원본 행을
직접 합산·카운트·평균내고, expected expression은 사람이 읽을 수 있는
source/operation/column 계약으로 별도 선언한다. `expansion-cases.mjs`는
benchmark case builder만 import하며 production dist를 import하지 않는다.

입력 변형 profile은 실제 외부 connector를 호출하지 않는다. 생성된 raw 자료는
다음처럼 경계를 확인할 수 있게 한다.

- CSV: source별 raw CSV
- XLSX: workbook과 sheet provenance
- PostgreSQL: 재현 가능한 CREATE/INSERT SQL fixture와 query fingerprint
- PDF: 표 추출 결과와 대응하는 최소 PDF fixture

이 자료는 connector/parser Product E2E의 대체가 아니다. 실제 PostgreSQL,
Docling PDF ingestion, Desktop, 승인, Slack stub은 별도 E2E profile에서
검증해야 한다.

## 판정과 지표

각 실행은 다음 네 가지 결과 중 하나로 판정된다.

- `correct_publish`: 기대 publish case에서 올바른 후보를 publish하고 holdout
  평가도 통과
- `correct_clarification`: 애매한 상황에서 clarification
- `correct_no_match`: 후보가 없거나 증거가 부족하여 중단
- `unsafe_publish`: 틀린 후보 또는 확정하면 안 되는 후보를 publish

주요 지표의 분모는 리포트에 함께 기록한다.

- `Correct Publish Rate`: numerator는 기대 publish case 중 올바른 source·expression을
  publish하고 holdout도 통과한 case, denominator는 모든 기대 publish case
- `False Publish Rate`: numerator는 publish했지만 `correct_publish`가 아닌
  case, denominator는 variant가 실제 publish한 모든 case
- `False Publish Rate Among Expected Non-publish`: numerator는 기대 outcome이
  `clarify`/`no_match`인데 publish한 case, denominator는 모든 기대 non-publish
  case. 거절하지 말아야 할 케이스를 실제로 확정했는지 보는 보조 지표다.
- `Safe Decision Rate`: numerator는 actual outcome이 expected outcome과 같은
  case, denominator는 전체 평가 case
- `Holdout Output Accuracy`: numerator는 기대 publish case 중 올바른
  source·expression을 publish하고 hidden holdout도 통과한 case, denominator는
  모든 기대 publish case
- `Holdout Pass Rate`: numerator는 hidden holdout을 평가한 publish case 중
  통과한 case, denominator는 hidden holdout을 평가한 publish case
- `Source Recovery Accuracy`: numerator는 기대 publish case 중 허용 source를
  publish한 case, denominator는 모든 기대 publish case
- `Clarification Rate`: clarification으로 멈춘 case 비율
- `Discovery Latency`: case 하나의 로컬 처리 시간

False Publish Rate만 단독으로 보지 않는다. 모든 case를 거절하는 시스템도
False Publish Rate 0%가 될 수 있으므로 Correct Publish Rate와 Safe Decision
Rate를 반드시 같이 본다.

## 안전 경계

이 benchmark는 `packages/core/dist`의 synthesis/evaluator 함수만 호출한다.
Gmail, Slack, HTTP, PostgreSQL, MySQL, AI provider와 통신하는 adapter를
등록하지 않는다. Replay 중 외부 side effect는 항상 0이어야 한다.

`D:\\ax\\_test\\acceptance\\테스트양식.pdf`는 이 benchmark의 gold answer가
아니다. 구현이 끝난 뒤 실제 입력을 넣는 별도 black-box acceptance fixture로
보존한다.

## Multi-seed sweep

프로필 하나를 한 seed로만 통과시키는 것은 값이나 특정 구조에 맞춘 구현을
놓칠 수 있다. `sweep.mjs`는 같은 profile 계약을 기본 10개 seed에 반복하고,
각 seed를 `D:\\ax\\_test\\sweeps\\<profile>\\seeds\\<seed>` 아래에 분리한다.
각 seed에는 기존 `report.json`, `failures.json`이 남고, sweep 루트에는 pooled
metrics와 seed별 metrics, seed가 붙은 failure rows를 담은
`runs/latest-aggregate.json` 및 Markdown 보고서가 생성된다.

예시:

```text
npm run test:wd-benchmark:sweep -- --profile expanded --generate --report
npm run test:wd-benchmark:sweep -- --profile schema-drift --generate --report --verify-safety
```

`expanded`에는 현재 의도적으로 노출된 B24~B26 holdout-generalization
실패가 포함되므로 `--verify-safety` 없이 실행하고, 실패를 aggregate에서
제거하지 않는다. schema-drift, source-confusion, input-variation은 Full
안전 게이트를 켠 채 sweep한다. seed는 숫자나 ID를 외우지 못하게 바꾸지만,
모든 실행을 다시 재현할 수 있도록 고정 문자열로 기록한다.

현재 기본 10-seed 실행 결과는 다음과 같다. schema-drift와
input-variation은 각각 140 case에서 Full correct publish 100%, false publish
0%였다. source-confusion은 Full false publish 0%였지만 일부 seed에서
유사 backup을 ambiguity로 보고 멈추는 보수적 판정이 관찰됐다. expanded는
300 case에서 Full correct publish 98.0%, false publish 13.27%, safe decision
88.67%였고, B24~B26 Full false publish가 각 10건씩 aggregate에 남았다.
이는 benchmark를 통과시키기 위해 기대값을 조정하지 않았다는 의미다. B24~B26
실패는 hidden holdout generalization/identifiability 또는 별도 capability의
평가 결과이며, hidden data를 제품 publish gate에 넣어 해결하지 않는다.
반대로 discovery 시점에 필수 관측값이 일부 training example에서 누락되어도
replay가 통과하던 문제는 관찰 가능한 제품 계약 위반으로 별도 수정했고,
`replay-runner` focused regression으로 고정했다.

## 해석 기준

이 결과는 Work Discovery의 현재 numeric/table 범위에 대한 검증이다. 모든
문서 형식이나 모든 workflow를 복원한다는 근거가 아니다. Product E2E에서는
별도로 PDF ingestion, 실제 앱 경계, 승인 UI, local Slack/HTTP stub을
검증한다.
