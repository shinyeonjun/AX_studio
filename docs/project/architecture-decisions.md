# AX Studio 아키텍처와 결정 기록

공통 엔진의 원칙은 **Jev의 제한된 판단, host 코드의 실행·검증, LLM CLI의 문안 생성**입니다. 이를 연결 도구 기반 개인 비서로 확장하는 것이 목표이고 Excel·규정 PDF는 첫 구현 사례입니다. 이 문서는 목표 구조와 현재 코드 경계를 함께 기록합니다. 새로운 흐름이나 범용 비서가 모두 구현됐다고 해석하면 안 됩니다.

## 책임 경계

| 영역 | 소유하는 책임 | 허용되지 않는 역할 |
| --- | --- | --- |
| 사용자와 검토 화면 | 요청·계획 검토, 예외 확인, 중요한 정책과 승인 | 불확실한 결정을 승인 없이 확정 |
| Jev 결정 계층 | host가 만든 후보의 선택, 제한된 분류·평가 | 임의 도구·경로·권한 생성, 스키마 검증 우회 |
| Host와 Runtime | 후보·계약 검증, 실행 순서·권한·승인, 읽기·계산·저장·출력 | 모델 응답만으로 부작용 승인 |
| LLM 문안 계층 | 설명, 요약, 보고서 서술 | 도구·수신자·실행 대상·필터·분기·승인 선택 |
| 증거와 상태 저장 | 입력 버전, 원본 위치, 판단·검토 이력, 결과 버전 | 출처 없는 추정값을 원본으로 대체 |

Jev와 LLM은 외부 모델 서비스 경계가 될 수 있습니다. 로컬 앱이라는 이유로 모든 데이터가 로컬에만 머문다고 설명하지 않습니다. 모델에 전달하는 데이터의 최소 범위와 민감 정보 처리는 별도 검토 대상입니다.

## 도구별 지식과 코드 제약

도구를 이름만 보고 연결하면 필드 의미·단위·날짜·상태·페이지 완전성·부작용을 놓칠 수 있습니다. 도구별 도메인 지식이 필요하다는 요구는 확정됐습니다. 다음 registry 계약은 구현 제안이며 현재 모든 connector에 적용됐다는 뜻은 아닙니다.

- 용도와 사용 전제, 입력·출력 타입과 호환 binding
- 데이터의 grain, 단위·시간대·날짜·상태 의미와 완전성·pagination
- 흔한 함정, 조인·필터·집계의 조건, 검증 사례와 실패 예
- 부작용·권한·승인, 중복 실행·idempotency와 재시도 제약
- 지식의 출처·버전과 변경 시 재검증

판단에는 관련 도구 지식만 전달해 문맥을 제한하고, 타입·허용 범위·권한·완전성 같은 hard constraint는 코드에서 검사합니다. 회사별 금액 기준이나 사용자 판단 정책은 도구 의미와 분리해 확인합니다. 도구 지식이 사용자 업무 규칙을 새로 만들거나 권한을 확대하지 않습니다.

## 목표 처리 흐름

공통 구조는 사용자 요청·개인 문맥 → host 도구 카탈로그·허용 후보 → Jev의 검색·계획·다음 행동 선택 → host 검증·실행 → 결과 검증 → LLM CLI 문안·사용자 검토입니다. 사용자별 문맥과 검토 기록을 유지하는 계약은 구현 설계가 남아 있습니다. 연결 도구의 native 검색을 우선하고, 색인을 추가하더라도 특정 벡터 DB를 사용자의 필수 설정으로 요구하지 않습니다. 어떤 검색 방식이 필요한지는 자료·도구의 특성과 비교 증거로 결정합니다.

아래는 공통 구조를 검증할 첫 Excel·규정 PDF 사례입니다.

1. **입력 확보:** 요청과 선택된 Excel·규정 PDF를 보존하고 입력 버전을 식별
2. **입력 검증:** 텍스트 추출, 원본 행·시트 범위, 읽기 완전성과 출처를 확인
3. **후보 생성:** host가 허용 작업·필드·규정 근거로 제한된 후보를 생성
4. **Jev 선택:** 후보 안에서 계획과 분류를 선택. 오류·불명확한 선택은 질문 또는 중단
5. **계약 검증:** 타입·바인딩·의존성·범위·권한을 코드로 검증하고 계획을 검토
6. **검토 기록:** 원본 행과 규정 근거를 표시하고 사람의 판단을 기록
7. **정확한 실행:** 확정된 정책으로 집계하고 XLSX·PDF를 생성
8. **결과 검증:** 누락·중복·합계·근거·검토 상태를 확인하고 버전별 결과를 기록

독립적인 단계는 의존성이 없고 권한·자원 한도가 허용할 때 병렬 실행할 수 있습니다. 병렬화가 데이터 순서나 부작용을 변경하지 않는지 별도로 검증합니다.

## 현재 소스와 전환 경계

기준 커밋은 [4071ce0](https://github.com/shinyeonjun/AX_studio/commit/4071ce0e82515f41d6763fc3ae8ba341a33f6555)입니다.

| 영역 | 현재 확인되는 코드 | 상태와 제한 |
| --- | --- | --- |
| Jev 채팅·계획 | [chat 결정 모듈](https://github.com/shinyeonjun/AX_studio/tree/4071ce0e82515f41d6763fc3ae8ba341a33f6555/packages/core/src/intelligence/agent/commands/chat) | 제한된 후보, 요청 계획, 도구 선택과 typed plan 검증 코드가 있음. 전체 예외 처리 제품의 완성을 뜻하지 않음 |
| Host 계획 검증 | [jev-plan-contract.ts](https://github.com/shinyeonjun/AX_studio/blob/4071ce0e82515f41d6763fc3ae8ba341a33f6555/packages/core/src/intelligence/agent/commands/chat/jev-plan-contract.ts) | 타입·입출력·참조·순환·필수 입력을 검증. 구조 검증만으로 업무 의미의 정확성을 보장하지 않음 |
| 원본 데이터 계약 | [artifact 계약](https://github.com/shinyeonjun/AX_studio/tree/4071ce0e82515f41d6763fc3ae8ba341a33f6555/packages/core/src/contracts/artifacts) | 원본 scalar 값·물리적 위치·완전성 보강은 별도 patch 구현·회귀 완료. 통합 미완료 |
| 새 예외 처리 모듈 | `packages/core/src/documents/exceptions/` | 독립 recipe 계약·후보 계획과 focused 회귀 구현. 전체 Core·타입 검증 진행 중. Global routing·Runtime·UI 연결과 행 분류·검토 기록·출력은 남아 있음 |
| Workflow 문안 경계 | [decision-outputs.ts](https://github.com/shinyeonjun/AX_studio/blob/4071ce0e82515f41d6763fc3ae8ba341a33f6555/packages/core/src/runtime/investigation/decision-outputs.ts), [decision-loop.ts](https://github.com/shinyeonjun/AX_studio/blob/4071ce0e82515f41d6763fc3ae8ba341a33f6555/packages/core/src/runtime/investigation/decision-loop.ts) | LLM 문자열이 후속 제어 입력에 연결될 수 있는 경계를 발견. 명시적 문안 계약과 바인딩 제한 작업 중 |
| 기존 PDF 보고서 | [reporting 모듈](https://github.com/shinyeonjun/AX_studio/tree/4071ce0e82515f41d6763fc3ae8ba341a33f6555/packages/core/src/documents/reporting) | 빈 양식·완성 예시 기반 기능 유지. LLM을 사용한 계획·근거 탐색·레이아웃 경계가 남아 있음 |

기존 PDF 경로의 LLM 경계는 [source-discovery.ts 251행](https://github.com/shinyeonjun/AX_studio/blob/4071ce0e82515f41d6763fc3ae8ba341a33f6555/packages/core/src/documents/reporting/planner/source-discovery.ts#L251), [evidence.ts 606행](https://github.com/shinyeonjun/AX_studio/blob/4071ce0e82515f41d6763fc3ae8ba341a33f6555/packages/core/src/documents/reporting/planner/evidence.ts#L606), [planner.ts 1063행](https://github.com/shinyeonjun/AX_studio/blob/4071ce0e82515f41d6763fc3ae8ba341a33f6555/packages/core/src/documents/reporting/planner/planner.ts#L1063)에서 확인했습니다. 이는 세 종류의 경계이며, 재시도 등을 포함한 실제 호출 횟수가 항상 3회라는 뜻은 아닙니다. 기존 보고서 테스트 통과를 Jev 전용 판단 검증으로 사용하지 않습니다.

## 대규모 DB 조회의 현재 한계와 제안

기준 소스 정적 감사에서 아래를 확인했습니다. 100만·1,000만 행의 지원·성능을 검증한 결과가 아닙니다.

- [RDB rows](https://github.com/shinyeonjun/AX_studio/blob/4071ce0e82515f41d6763fc3ae8ba341a33f6555/packages/core/src/connectors/rdb/client/rows.ts#L34)는 `SELECT *`와 `LIMIT/OFFSET` 읽기를 사용하며 해당 경로에 정렬·필터·projection·서버 집계·조인 계약이 없습니다
- [table.describe](https://github.com/shinyeonjun/AX_studio/blob/4071ce0e82515f41d6763fc3ae8ba341a33f6555/packages/core/src/connectors/rdb/connector.ts#L55)는 구현되어 있습니다. [describe metadata](https://github.com/shinyeonjun/AX_studio/blob/4071ce0e82515f41d6763fc3ae8ba341a33f6555/packages/core/src/connectors/rdb/client/describe.ts#L36)는 column 중심이며 업무 grain·단위·검증된 key를 모두 알 수 있는 계약은 아닙니다
- [Report capture](https://github.com/shinyeonjun/AX_studio/blob/4071ce0e82515f41d6763fc3ae8ba341a33f6555/packages/core/src/documents/reporting/source/capture.ts#L210)는 기본 100,000행·32MiB 한도로 행을 메모리에 materialize합니다. capture provenance의 읽기 일관성은 `unverified`입니다
- [Report 실행](https://github.com/shinyeonjun/AX_studio/blob/4071ce0e82515f41d6763fc3ae8ba341a33f6555/packages/core/src/documents/reporting/plan/execute.ts#L109)은 불완전한 source와 선언한 cardinality를 검사하지만 조인·집계는 JavaScript에서 실행합니다

첫 개선 제안은 metadata → host 검증된 typed query IR → dialect compiler → parameterized SQL 필터·projection·count·sum·group-by → 범위·snapshot·완전성이 명시된 제한 결과 artifact입니다. 전체 행을 모델이나 앱 메모리로 옮기지 않고 source 측에서 필요한 계산을 수행하는 방향입니다. 구현과 실제 DB 인수는 아직 남아 있습니다.

조인은 검증된 key·grain·fan-out 조건을 먼저 정의해야 합니다. [기존 aggregate](https://github.com/shinyeonjun/AX_studio/blob/4071ce0e82515f41d6763fc3ae8ba341a33f6555/packages/core/src/documents/reporting/plan/aggregate.ts#L24)와 [값·predicate 처리](https://github.com/shinyeonjun/AX_studio/blob/4071ce0e82515f41d6763fc3ae8ba341a33f6555/packages/core/src/documents/reporting/plan/value.ts#L40)의 null·coercion·empty aggregate 의미를 SQL로 옮길 때 보존해야 합니다. SQL 집계로 단순 교체하거나 pagination만으로 같은 시점의 전체 데이터를 읽었다고 가정하지 않습니다.

## 원본과 검토 기록의 설계

원본 식별은 파일 내용의 digest, 시트, 물리적 행·열을 기준으로 유지합니다. 계산용 정규화 값과 원본 값은 별도로 보존합니다. 업무 ID만 행 식별자로 사용하면 중복 ID나 정렬 변경을 안전하게 다룰 수 없습니다.

원본 보강 patch는 선택적 `rawValues`, `sourceRow`, `sourceColumn`, `contentHash`, `headerRow`와 워크북 `completeness`를 추가합니다. 행 `key`는 원본 bytes의 SHA-256, 정확한 시트 이름, 1-based 물리적 행의 조합에 연결합니다. 행·열·header 좌표는 1-based이고 화면의 상대 행 index와 구분합니다. 선택한 열만 투영할 때 원본 값도 같은 열로 제한해 제외된 열이 결과에 남지 않도록 합니다.

이 patch는 원본 scalar 값과 좌표를 보존하며 수식·표시 서식·오류 셀 메타데이터·전체 XML을 보존하는 변경은 아닙니다. CSV도 변경하지 않았습니다. blank used-range 행까지 보수적으로 포함하므로 물리적 행 수와 실제 업무 record 수를 구분해야 합니다. 통합과 새 흐름이 이 원본 필드를 사용한다는 검증은 남아 있습니다.

새 흐름에서는 규정 digest와 근거 위치, 선택된 결정, 검토 상태도 원본 버전에 연결해야 합니다. 검토 기록의 정확한 계약과 만료 정책은 아직 구현·제품 검토가 남아 있습니다. 요청이 한도를 넘으면 일부를 조용히 잘라 판단하지 않고 크기 문제를 반환하는 방향으로 설계합니다.

## 결정 기록

초기 항목의 날짜는 최초 승인일 대신 재구성 확인일입니다. 2026-10-01 당일 항목은 해당 결정이 확인된 시점을 기록했습니다.

| ID | 결정 | 상태와 시점 | 이유와 영향 |
| --- | --- | --- | --- |
| D01 | 자연어 자료와 숫자 자료를 함께 처리하는 Excel·보고 업무에 우선 집중 | 확정 방향, 최초 결정일 미확인. 2026-10-01 재구성 | Gmail·Slack 확장보다 결과 정확성과 출처를 먼저 검증 |
| D02 | 제한된 Jev 판단과 모듈식 typed 단계, 코드 실행·검증, 계획 검토 | 확정 방향, 최초 결정일 미확인. 2026-10-01 재구성 | 후보·계약을 검사하고 독립 단계 병렬화. 1–2초는 성능 가설 |
| D03 | 새 흐름의 LLM은 문안 전용이며 판단 fallback 없음 | 확정 방향, 2026-10-01 확인 | 이전 연구 문서의 선택적 LLM 계획 제안은 새 strict 흐름에 적용하지 않음. 기존 PDF 경로는 전환 전 별도로 표시 |
| D04 | Jev 전용 Excel·규정 PDF 흐름을 별도 구현하고 기존 PDF 기능 보존 | 확정, 2026-10-01 09:16 UTC | 핵심 원칙을 제한된 흐름에서 검증한 뒤 공통 요소 통합 검토 |
| D05 | 기획·설계·개발·트러블슈팅·검증·릴리스를 문서화하고 FigJam 상태 확인 | 확정, 2026-10-01 확인 | 저장소 문서에 근거를 유지하고 구조 그림과 검토 자료를 적절히 연결 |
| D06 | Git Flow로 개발 브랜치와 테스트 prerelease를 지속 운영 | 확정, 2026-10-01 09:24 UTC | `main`은 안정 버전, `develop`은 통합, `feature/`·`release/`·`hotfix/`는 목적별 작업. main 병합·정식 릴리스는 제품 책임자 확인 |
| D07 | 연결 도구 기반 범용 개인 비서를 제품 목표로 하고 Excel·PDF를 첫 인수 사례로 사용 | 확정 방향, 2026-10-01 후속 대화 | 사무직·분석가·경영자·개발자를 같은 엔진의 시나리오로 검증. 모든 기능의 현재 제공을 보장하지 않음 |
| D08 | Jev·LLM CLI·도구 연결 중심의 시작 경험, 사용자 RAG 구축·workflow 설계 불필요 | 확정 방향, 2026-10-01 후속 대화 | native 도구 검색 우선. 인증·권한은 필요하며 내부 색인 도입은 자료 특성과 증거로 검토 |
| D09 | AX와 LLM agent·RAG를 공정 조건에서 비교하고 실패도 학습 근거로 기록 | 확정 평가 방향, 2026-10-01 후속 대화 | 정확도·시간·토큰·비용의 우위를 전제하지 않음. 유료 benchmark 실행 승인과 평가 데이터는 별도 |
| D10 | 각 도구의 도메인 지식을 활용해 정확하게 연결 | 확정 요구, 2026-10-01 후속 대화. 구체 registry는 제안 | 도구 의미와 사용자 업무 정책 분리, 관련 지식만 Jev 문맥에 전달, hard constraint는 코드 검증 |

새 결정은 영향받는 요구사항, 선택한 대안, 호환성 영향과 검증 증거를 함께 추가합니다. 제안이나 구현자의 가정을 승인된 결정으로 올리지 않습니다.
