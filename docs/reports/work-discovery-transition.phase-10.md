# Work Discovery Transition — Phase 10

검증 시각: 2026-08-31T01:23:52.3973189+09:00

## 구현한 것

- Phase 9 input-schema drift가 감지되면 runtime은 저장된 workflow에 대해
  bounded `rename_column` 후보만 생성한다. ephemeral plan이나 저장되지 않은
  draft에는 repair state를 만들지 않는다.
- `workflow_repair_proposals` SQLite 테이블과 repository를 추가했다. 후보,
  기준 workflow version, 상태, dedupe key, replay 요약만 저장하며 행 값,
  결과 payload, credential은 저장하지 않는다.
- `repair.list`, `repair.inspect`, `repair.apply`, `repair.reject` command를
  추가했다. host 조회 경계에서는 apply/reject가 거부되고 agent mutation
  경계에서만 처리된다.
- `repair.inspect`와 `repair.apply`는 Work Discovery가 이미 저장한 historical
  snapshot manifest/replay case만 사용한다. live connector나 외부 provider는
  호출하지 않는다.
- 모든 historical replay case가 통과해야 apply할 수 있다. 성공한 apply는
  monotonic한 새 workflow version을 만들고 `rollbackVersion`으로 기준
  version을 반환한다. 이전 version은 삭제하지 않는다.
- apply 구현은 선택된 source/step의 transform column reference와 대응하는
  input schema 이름만 바꾼다. trigger/schedule, approval, side effect,
  threshold, recipient, connector action params, data policy는 변경하지 않는다.

## 검증 fixture

- rename fixture: historical case 3개를 모두 재생해 `3/3 PASS`.
- snapshot 누락 fixture: `historical_snapshot_unavailable`로 apply evidence를
  fail-closed 처리.
- command fixture: inspect `1/1 PASS` → apply → workflow version `1 → 2`,
  version 1의 원래 mapping과 version 2의 repaired mapping을 각각 확인.
- runtime fixture: 현재 source column이 `customer_count`에서 `customers`로
  바뀐 경우 외부 동작 없이 repair proposal만 생성.

## 막은 failure mode

- schema drift를 감지한 실행이 모델이나 runtime에 의해 자동 remap되지 않음.
- 과거 snapshot이 없거나 읽히지 않으면 repair 적용 불가.
- 기준 workflow version이 최신과 다르면 stale conflict로 중단.
- 이미 applied/rejected proposal은 lifecycle상 재처리 불가.
- host-origin command가 repair mutation을 직접 호출할 수 없음.
- 후보와 replay 결과에 raw cell/value가 포함되지 않음.

## 실행한 검증

- focused repair/runtime/command: `5 files, 54 tests PASS`
- full Core: `122 files, 620 tests PASS, 3 skipped`
- Core evaluation: `11/11 PASS`
- architecture: `0 violations, 502 modules, 1750 dependencies`
- Core typecheck: PASS
- production build: Core + Electron main/preload/renderer PASS
- Desktop typecheck: PASS
- root integration: `9 suites, 56 tests PASS`
- repository test typecheck: PASS
- root Electron E2E/Product QA: `4 passed`, generated batch `14 scenarios`
- knip: PASS
- `git diff --check`: PASS (기존 Windows line-ending 경고만 출력)

## 의도적으로 안 한 것

- rename 후보 이상의 의미 추론, threshold/recipient/approval/schedule/side
  effect 변경은 하지 않았다.
- live source 재조회와 provider smoke test는 하지 않았다.
- 새 repair 전용 UI는 만들지 않았다. 기존 command와 versioned store를
  안정적인 seam으로 먼저 완성했다.

## 남은 구멍

- 현재 후보 생성은 source column rename만 지원한다. 실제 업무에서 의미가
  다른 두 column을 자동 판별하는 기능은 사용자 선택과 별도 설계가 필요하다.
- rollback은 이전 version 보존과 apply 응답의 기준 version 반환으로 보장된다.
  전용 rollback UI/command는 다음 제품 운영 단계의 선택 과제다.
- 외부 connector payload의 업무 의미까지 historical replay하는 것은 이번
  단계에서 의도적으로 제외했다.

## 범위 판단

runtime quality gate에 후보 생성 seam을 추가하고, 이를 안전하게 저장·조회·
replay·version apply하기 위해 workflow/store/command 계층까지 확장했다. Desktop
화면과 connector 구현은 변경하지 않았다. 기존 사용자 변경인 `.gitignore`는
끝까지 건드리지 않았다.
