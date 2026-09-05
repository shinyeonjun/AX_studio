# Work Discovery Benchmark v1 ablation comparison

## 상태

- 실행 시각: 2026-09-04 11:52:42.517 +09:00
- source benchmark: 동결된 `v1` expanded fixture
- 입력: 10개 deterministic seed × 30개 scenario = 300개
- 결과 root: `D:\ax\_test\ablations\v1-expanded-10-seed`
- runner SHA-256: `C79A987E7E5984FA968F119C0ED3CDA6D4042F81FB69570D2BAEF8B1B20CBD64`
- latest raw report SHA-256: `61CFBC5A4F8572B616642434A324C43C16E261ECBBF8F84CB437E3A89FA4D35D`
- latest manifest SHA-256: `C58632A500BDAE7BA048BD97F5E7696D1B6C5C8BA116A46387461CC701425212`
- 제품 코드, fixture, gold answer, seed, 기존 v1 report는 변경하지 않았다.

이번 작업은 동결된 v1을 다시 설계한 것이 아니라, 이미 존재하는 세 조건에
`No Replay + No Clarification`을 추가한 비교 실험이다. holdout은 모든 조건에서
결정이 끝난 뒤에만 평가했다.

## 조건

| 조건 | 의미 |
|---|---|
| `Full` | 기존 동결 benchmark의 replay + ambiguity/clarification 경로 |
| `No Replay` | training replay 없이 단순성 기준으로 후보를 선택 |
| `No Clarification` | replay 후에도 ambiguity를 자동 확정 |
| `No Replay + No Clarification` | replay와 clarification을 모두 사용하지 않는 독립 비교 경로 |

## Aggregate 결과

| 조건 | 올바른 publish | False publish | 기대 non-publish를 publish | Safe decision | Holdout pass | Clarification |
|---|---:|---:|---:|---:|---:|---:|
| Full | 196/200 (98.0%) | 30/226 (13.27%) | 30/100 (30.0%) | 266/300 (88.67%) | 196/226 (86.73%) | 44 |
| No Replay | 10/200 (5.0%) | 290/300 (96.67%) | 100/100 (100.0%) | 200/300 (66.67%) | 10/300 (3.33%) | 0 |
| No Clarification | 200/200 (100.0%) | 70/270 (25.93%) | 70/100 (70.0%) | 230/300 (76.67%) | 220/270 (81.48%) | 0 |
| No Replay + No Clarification | 10/200 (5.0%) | 290/300 (96.67%) | 100/100 (100.0%) | 200/300 (66.67%) | 10/300 (3.33%) | 0 |

`False publish`의 분모는 실제로 publish한 case이고, `기대 non-publish를
publish`의 분모는 기대값이 `clarify` 또는 `no_match`인 case다. 따라서 두
지표는 서로 대체해서 해석하지 않는다.

## 해석

1. Replay는 핵심 안전장치다. Full은 No Replay보다 safe decision이
   `200/300 → 266/300`으로 올라가고, false publish가 `290건 → 30건`으로
   줄었다.
2. Clarification은 애매한 후보의 자동 확정을 줄인다. Full은 No Clarification보다
   기대 non-publish 확정이 `70건 → 30건`으로 줄고, safe decision이
   `230/300 → 266/300`으로 올라갔다.
3. 네 번째 조건은 No Replay와 scenario outcome·metric이 `300/300` 일치했다.
   이는 별도의 효과가 없다는 뜻이 아니라, 현재 구현에서 No Replay 경로가
   이미 clarification 단계에 들어가지 않는다는 것을 독립 경로로 확인한
   결과다. 이후 설명에서는 두 조건을 중복된 결과로 숨기지 말고, 이 구조적
   이유를 함께 적는다.
4. Full의 남은 30건은 B24~B26의 hidden holdout 일반화 실패다. 이 데이터는
   discovery나 publish 결정에 노출되지 않았으며, 기존 분류와 raw evidence를
   그대로 보존했다.

## 보존된 evidence

ablation runner는 seed/scenario별 전체 결과를 별도 root에 보존한다.

```text
D:\ax\_test\ablations\v1-expanded-10-seed\latest.json
D:\ax\_test\ablations\v1-expanded-10-seed\latest.md
D:\ax\_test\ablations\v1-expanded-10-seed\latest-failures.json
D:\ax\_test\ablations\v1-expanded-10-seed\latest-failures.md
D:\ax\_test\ablations\v1-expanded-10-seed\manifest.json
```

독립적인 네 번째 경로와 기존 No Replay의 결정 결과가 같은지 자동 검증했고,
`matchingCases=300/300`, `metricsEqual=true`였다. 여기서 metric equality는
실행 시간처럼 매번 달라질 수 있는 latency를 제외한 결정 지표 비교다. 기존 frozen aggregate의
SHA-256은 ablation manifest에도 기록된다.

## 결론과 다음 경계

Benchmark 제작·변형·seed 확장 단계는 여기서 끝낸다. 현재 실험으로 보고할
핵심은 다음과 같다.

> Replay는 후보의 관찰 결과 재현을 검증해 잘못된 publish를 크게 줄이고,
> clarification은 현재 evidence로 구분할 수 없는 후보를 자동 확정하지 않게
> 한다. 다만 보지 못한 미래 데이터의 일반화는 현재 제품 계약만으로 보장하지
> 못한다.

이후에는 이 결과를 발표용 표와 failure case 설명에 사용하고, PDF
ingestion/export 및 Desktop 승인·실행은 별도의 Product E2E로 검증한다.
새로운 validation example이나 cross-validation 기능이 필요하면 `v1`을
수정하지 않고 별도 요구사항·실험 버전으로 시작한다.
