# Work Discovery hidden-holdout findings

## 결정

이 문서는 `holdout` 및 `expanded` benchmark에서 발견된 B24~B26을
분류하기 위한 기록이다. `holdout` examples는 후보 생성, training replay,
ambiguity 판정, publish 결정에 전달하지 않는다. benchmark runner가
discovery 결정을 끝낸 뒤에만 숨겨진 결과를 평가한다.

따라서 이 문서의 mismatch는 “미래 데이터를 보고 제품이 publish를 막아야
한다”는 결론이 아니다. 사용자가 별도로 validation example을 제공하는 기능이나
cross-validation을 제품에 도입하려면 새로운 요구사항·설계·평가로 다뤄야 한다.

## B24~B26 분류

| Case | discovery에서 제공된 evidence | discovery 결정 | hidden holdout 결과 | 분류 | 판단 |
|---|---|---|---|---|---|
| B24 | 3개 training example에서 `rdb:orders`의 `SUM(amount)` 후보가 replay 통과 | publish | 보지 못한 holdout의 관찰값은 row count라서 `SUM(amount)`과 불일치 | `algorithmic_limitation` | training evidence만으로 미래에 합계가 건수로 바뀐 것을 식별할 수 없다. |
| B25 | 3개 training example에서 `rdb:orders`의 `AVG(amount)` 후보가 replay 통과 | publish | holdout에서 해당 source snapshot이 없음 | `missing_product_capability` | 미래 source availability/data readiness는 현재 discovery 계약의 입력이 아니다. |
| B26 | 3개 training example에서 `rdb:targets`의 `SUM(actual) / SUM(target)` 후보가 replay 통과 | publish | holdout의 denominator가 0이라 정상 달성률을 계산할 수 없음 | `missing_product_capability` | 미래 data-quality/zero-denominator 정책은 현재 discovery 계약에 없다. |

B24~B26의 gold outcome과 fixture는 이 분류 때문에 바꾸지 않는다. 각 실행의
`failures.json`에는 다음 근거가 함께 보존된다.

- `discoveryEvidence`: training example/source/snapshot/observation 목록과
  후보별 replay 결과
- `publishDecision`: 선택된 후보, 후보 수, ambiguity 경로
- `holdoutEvidence`: hidden example/snapshot과 사후 평가 결과
- `findingKind`, `findingClass`, `findingScope`, `findingReason`

## 제품 버그와 평가 한계의 분리

필수 observation path가 한 training example에 아예 없는데도 다른 example만
보고 후보가 accepted 되는 문제는 discovery 시점에 관찰 가능한 제품 계약
위반이었다. `packages/core/src/work-discovery/synthesis/replay-runner.ts`는
누락된 필수 path에 명시적인 실패 replay를 추가하도록 최소 수정했고,
`replay-runner.test.ts`에 회귀 테스트를 추가했다.

이 수정은 B24~B26의 hidden holdout을 제품에 노출하거나 holdout gate를 추가한
것이 아니다. 두 종류의 결과를 섞지 않기 위해 제품 버그 수정과 hidden-holdout
일반화 평가는 별도로 기록한다.

## 지표 계약

모든 variant의 JSON report에 numerator와 denominator를 함께 저장한다.

| Metric | Numerator | Denominator | Eligible |
|---|---|---|---|
| `correctPublishRate` | 기대 publish이며 올바른 source/expression을 publish하고 hidden holdout도 통과한 case | 기대 publish case | positive publish |
| `falsePublishRate` | publish했지만 `correctPublish`가 아닌 case | 실제 publish case | all published |
| `falsePublishRateAmongExpectedNonPublish` | 기대 outcome이 `clarify`/`no_match`인데 publish한 case | 기대 non-publish case | negative decision |
| `safeDecisionRate` | actual outcome과 expected outcome이 같은 case | 전체 case | all cases |
| `holdoutOutputAccuracy` | 기대 publish이며 올바른 source/expression을 publish하고 hidden holdout도 통과한 case | 기대 publish case | positive publish |
| `holdoutPassRate` | hidden holdout을 평가한 publish case 중 통과한 case | hidden holdout을 평가한 publish case | published with holdout |
| `sourceRecoveryAccuracy` | 기대 publish이며 허용된 source를 publish한 case | 기대 publish case | positive publish |

`falsePublishRate`는 실제 publish 결과의 심각도를 보는 지표이고,
`falsePublishRateAmongExpectedNonPublish`는 확정하면 안 되는 case를 확정한
비율이다. 둘의 분모가 다르므로 report에서 하나를 다른 하나로 추정하지 않는다.
분모가 0인 rate는 0%가 아니라 `null`로 기록한다.

## 재현 명령

```text
node test/work-discovery-benchmark/run.mjs --profile holdout --root D:\\ax\\_test\\profiles\\holdout --seed wd-holdout --generate --report --skip-build
npm run test:wd-benchmark:sweep -- --profile expanded --root D:\\ax\\_test\\sweeps\\expanded --generate --report --skip-build
```

`expanded`의 B24~B26 failure row는 삭제하거나 safety gate를 약화하지 않고
seed별로 보존한다. 이 benchmark는 hidden holdout을 제품의 publish gate로
사용하지 않는다.
