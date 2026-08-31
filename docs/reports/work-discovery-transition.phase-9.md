# Work Discovery transition — Phase 9

## 구현한 것

- Work Discovery가 필수 출력 관찰값에서 `OutputContract`을 만들고, 컴파일된
  WorkflowIR에 출력 필드 기준선과 매핑에 필요한 입력 열 계약을 함께 저장한다.
- 수치·행 수 기준은 역사 샘플이 두 개 이상일 때만 보수적 범위를 사용한다.
  단일 샘플은 필수 여부와 타입만 검사하므로 기존 업무의 값 변화 자체를
  드리프트로 오판하지 않는다.
- Runtime은 source step 뒤 입력 열 누락/타입 변경을 검사하고, 외부 action 직전에
  출력 필수 섹션·타입·범위를 검사한다. 실패하면 외부 connector를 호출하지 않고
  `input_schema_drift` 또는 `output_contract_failed`로 남긴다.
- 실행 로그와 `execution.explain`에는 단계·코드·필드·기대 범위 같은 제한된 메타데이터만
  남긴다. 행, 메시지 본문, 원본 출력값, 실행 파라미터는 반환하지 않는다.
- Desktop 활동 화면에서 결과 품질 실패를 기술 실행 실패와 구분해 표시한다.

## 의도적으로 안 한 것

- 이름 변경 후보 생성, replay 기반 repair, apply/reject, 새 workflow version과
  rollback은 Phase 10으로 남겼다.
- threshold, recipient, approval, AND/OR, schedule, side effect를 자동 변경하지 않는다.
- ArtifactStore 레이아웃과 connector 자체의 동작은 변경하지 않았다.

## 재현한 fixture

- `80–120` historical customer-count 기준에서 현재 값 `3`: `output_volume_anomaly`
  로 차단되고 Mock Slack 전송은 `0`건이다.
- historical sample이 하나뿐인 `300`에서 현재 `600`: 타입/필수성 검사는 통과하고
  범위 검사는 적용하지 않는다.
- `customer_count` 열 이름 누락과 숫자→문자열 변경: 각각
  `schema_column_missing`, `schema_type_changed`로 차단한다.
- `execution.explain`은 결과 품질 실패의 `technicalStatus=completed`,
  `resultStatus=failed`와 안전한 이유만 반환한다.

## 막은 failure mode

- HTTP 200 또는 connector 기술 성공만으로 결과를 성공 처리하는 silent degradation
- source 열 rename/type drift 이후 계산값이 사라지거나 잘못된 상태로 외부 발송되는 문제
- 실행 설명 요청에서 원본 행·메시지·파라미터가 노출되는 문제

## 검증

- Focused: 5 files / 51 tests
- Full Core: 119 files / 609 passed / 3 skipped
- Core eval: 11/11
- Architecture: 0 violations, 495 modules / 1705 dependencies
- Core/Desktop build 및 Core/Desktop/test typecheck: PASS
- Root integration: 9 suites / 56 tests
- Root Electron E2E: 4 Playwright tests, generated 14-scenario batch 포함
- Knip 및 `git diff --check`: PASS
