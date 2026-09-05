# Work Discovery Benchmark v1 — frozen results

## 상태

- 동결 시각: 2026-09-04 11:41:24 +09:00
- 실행 환경: 저장소 `D:\AX_studio`, 외부 fixture/report root `D:\ax\_test`
- 범위: Work Discovery의 현재 table/numeric synthesis 경계
- 상태: `v1` 최종 결과. 이후 benchmark나 제품 동작을 바꾸면 새 실험 버전으로 기록한다.

이 문서는 benchmark를 통과시키기 위해 제품을 조정한 결과가 아니다. 이미
정의된 fixture, 독립 gold answer, seed, variant, 지표 계약을 마지막 코드
상태에서 재실행해 결과를 고정한 기록이다.

## 결론

현재 Full 흐름은 후보를 단순히 고르는 것보다 training replay와 clarification을
포함할 때 안전한 결정을 더 잘 만든다. 10개 seed, 30개 case씩 총 300개를
실행한 expanded sweep에서 다음 결과가 나왔다.

| Variant | 올바른 publish | 잘못된 publish | 안전한 결정 | Holdout 통과 | 비고 |
|---|---:|---:|---:|---:|---|
| AX Full | 196/200 (98.0%) | 30/226 (13.27%) | 266/300 (88.67%) | 196/226 (86.73%) | B24~B26 실패를 숨기지 않음 |
| Replay 제거 | 10/200 (5.0%) | 290/300 (96.67%) | 200/300 (66.67%) | 10/300 (3.33%) | 후보 검증 부재의 효과 |
| Clarification 제거 | 200/200 (100.0%) | 70/270 (25.93%) | 230/300 (76.67%) | 220/270 (81.48%) | 애매한 후보를 자동 확정 |

`98.0%`와 `13.27%`는 모순되지 않는다. 올바른 publish는 기대 publish
200건을 분모로 하고, false publish는 실제로 publish된 226건을 분모로 한다.
기대 non-publish를 확정한 비율은 별도 지표인 `30/100 = 30.0%`로 기록했다.

이 수치는 “모든 업무를 자동으로 복원한다”는 증명이 아니다. 현재 구현이
지원하는 결정적 table/numeric 업무에서 replay가 과적합 후보를 줄이고,
clarification이 애매한 상황의 자동 확정을 줄이는 효과를 보여주는 결과다.

## 프로필별 Full 결과

모든 프로필은 같은 Full/replay/clarification 계약을 사용하며, safe profile은
10개 seed sweep으로도 반복했다.

| Profile | Case | 기대 publish | 올바른 publish | Full false publish | 안전한 결정 | Clarification |
|---|---:|---:|---:|---:|---:|---:|
| v1 | 10 | 6 | 6/6 (100%) | 0 | 10/10 (100%) | 2 |
| rotating | 14 | 10 | 10/10 (100%) | 0 | 14/14 (100%) | 2 |
| schema-drift sweep | 140 | 100 | 100/100 (100%) | 0 | 140/140 (100%) | 20 |
| source-confusion sweep | 140 | 80 | 76/80 (95%) | 0 | 136/140 (97.14%) | 34 |
| input-variation sweep | 140 | 100 | 100/100 (100%) | 0 | 140/140 (100%) | 20 |
| holdout | 14 | 6 | 6/6 (100%) | 3 | 11/14 (78.57%) | 3 |
| expanded sweep | 300 | 200 | 196/200 (98%) | 30 | 266/300 (88.67%) | 44 |

source-confusion의 4건은 잘못 publish하지 않고 보수적으로 멈춘 결과다.
이 경우 `source recovery`가 76/80으로 떨어지지만 Full의 unsafe publish는
0건으로 유지됐다. expanded의 30건 false publish는 모두 B24~B26의 hidden
holdout 일반화 실패이며, 10개 seed에서 각 case가 10회씩 재현됐다.

## B24~B26의 의미

holdout은 discovery나 publish 결정에 전달하지 않고, 결정이 끝난 뒤에만
평가했다. 따라서 이 결과를 제품에 미래 데이터를 미리 보여주는 holdout gate의
근거로 사용하지 않는다.

| Case | 분류 | 의미 |
|---|---|---|
| B24 | `algorithmic_limitation` | training evidence만으로 합계 규칙이 holdout에서 건수 규칙으로 바뀌는 것을 식별할 수 없음 |
| B25 | `missing_product_capability` | holdout에서 source가 사라지는 미래 source readiness 정책이 현재 계약에 없음 |
| B26 | `missing_product_capability` | holdout의 0 분모를 처리할 미래 data-quality 정책이 현재 계약에 없음 |

이 세 사례의 fixture와 gold answer는 변경하지 않았다. 별도의 validation
example, cross-validation, source readiness, zero-denominator 정책은 다음
제품 요구사항으로 남긴다.

반대로 training example에서 필수 observation이 누락됐는데도 replay가
그 example을 건너뛰던 문제는 discovery 시점에 관찰 가능한 제품 계약 위반으로
분리했다. 해당 경로는 fail-closed로 수정했고, focused regression으로 고정했다.

## 동결한 계약

- 골든 `v1` 10개와 `rotating` 변형은 유지한다.
- `schema-drift`, `source-confusion`, `holdout`, `input-variation`, `expanded`
  프로필과 10개 deterministic seed를 유지한다.
- Full, replay 제거, clarification 제거 세 variant의 정의와 지표 분모를
  변경하지 않는다.
- gold answer는 production candidate enumeration/replay/evaluator에서 만들지
  않는다.
- holdout은 평가 전용이며 product discovery/replay/publish 입력이 아니다.
- 네트워크·AI provider·Gmail·Slack·HTTP·PostgreSQL·MySQL side-effect adapter는
  benchmark에 등록하지 않는다.
- `D:\ax\_test\acceptance\테스트양식.pdf`는 실제 black-box acceptance 용도이며
  benchmark 정답이나 구현 oracle이 아니다.

## 재현

동일한 저장소 상태와 기존 `D:\ax\_test` fixture를 사용해 다음처럼 실행한다.

```text
node test/work-discovery-benchmark/run.mjs --profile v1 --root D:\ax\_test --seed wd-v1 --report --verify-safety --skip-build
node test/work-discovery-benchmark/sweep.mjs --profile expanded --root D:\ax\_test\sweeps\expanded --report --skip-build
node test/work-discovery-benchmark/verify-report.mjs --root D:\ax\_test\sweeps\expanded --aggregate
```

최종 artifact 경로와 SHA-256은
[`work-discovery-benchmark-v1-freeze.md`](work-discovery-benchmark-v1-freeze.md)에
기록했다.

## 다음 단계의 경계

이제 이 benchmark를 결과에 맞춰 더 튜닝하지 않는다. 다음 작업은 별도 트랙으로
분리한다.

1. 발표·보고서용 결과 해석과 failure case 설명
2. PDF ingestion → HTML 편집 → PDF export의 Product E2E/시각 검증
3. Desktop 승인·워크플로우·local Slack/HTTP stub을 포함한 실제형 E2E
4. 필요성이 확인될 때만 validation example/cross-validation 같은 새 기능 설계
