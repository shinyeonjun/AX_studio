# 대규모 구조화 데이터 Discovery 근거

조사일: 2026-09-05. 범위: Snowflake Semantic Views/Cortex Analyst, dbt Semantic Layer, Spider 2.0의 1차 자료. 제품 구현·도구 discovery/JIT/retrieval 아키텍처는 범위 밖이다. 아래 **제안**은 문서의 제품 기능과 구분한 AX Studio 설계 추론이다.

## 핵심 판단

구조화 데이터 discovery에는 관련 소스를 찾는 능력과, 그 소스가 질문의 조인·집계 단위(grain)·시간 의미를 충족하는지 판정하는 능력이 모두 필요하다. Snowflake는 스키마만으로 부족한 비즈니스 정의를 semantic view의 논리 테이블·차원·행 수준 fact·집계 metric·관계로 보완한다. **제안:** AX Studio AI는 이 의미를 해석하고 근거가 붙은 구조화 계획을 제시하며, host가 메타데이터 조회·검증·도구 호출·실행을 소유한다. 이는 AX 원칙에 따른 적용이며, 공급사 내부 구현이 같은 경계를 보장한다는 주장은 아니다. [Snowflake 개요](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst)

## 확인한 근거와 적용

| 쟁점 | 1차 자료에서 확인한 사실 | AX Studio 적용 제안 |
| --- | --- | --- |
| 소스 선택 | Cortex Analyst API는 요청의 `semantic_models` 목록에서 적합한 모델/view를 선택하고 `semantic_model_selection`을 반환한다. 모호해서 SQL을 만들지 못하면 `suggestion`을 반환한다. | host가 권한·범위에 맞는 후보를 제공하고 AI가 선택 근거·대안·미해결 질문을 반환한다. 제공된 후보 중 선택하는 기능을 전체 데이터 자산의 자동 발견이나 모델 간 임의 조인으로 확대 해석하지 않는다. [API](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst/rest-api) |
| 조인과 grain | dbt MetricFlow는 entity를 조인 키로 사용하는 그래프를 만들고, entity 유형에 따라 fan-out/chasm 조인을 제한한다. 예컨대 primary→foreign은 허용하지 않는다. `EXPLAIN` 기반 검증으로 참조·함수·경로 모호성을 검사한다. | 테이블 이름 유사도 외에 행의 의미, 키, 카디널리티, 조인 방향, 집계 전후 단위를 계획에 포함한다. 실행 가능한 SQL이어도 집계 정확성은 별도로 확인한다. [dbt Joins](https://docs.getdbt.com/docs/build/join-logic) |
| 관계 정의의 버전 차이 | Snowflake semantic view는 관계 컬럼과 키 정의를 사용하며, legacy semantic model의 `join_type`/`relationship_type`을 필수로 요구하지 않는다. | 특정 공급사의 YAML 필드를 공통 계약으로 고정하지 말고, 의미상 관계와 검증 근거를 보존한다. [Semantic view YAML](https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec) |
| 시간 의미 | dbt는 집계 기준 시간인 `agg_time_dimension`과 시간 granularity를 구분한다. 월 데이터를 시간 단위로 세분화할 수 없으며, SCD Type II는 유효 시작·종료 시점을 사용한다. Snowflake는 시간 차원 설명에 시간대를 명시하도록 권고한다. | 주문일/결제일, 달력/회계 기간, 시간대, 구간 경계, 현재 속성/당시 속성을 명시한다. “월별 매출”만으로 이 선택을 확정하지 않는다. [dbt Dimensions](https://docs.getdbt.com/docs/build/dimensions), [Snowflake YAML](https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec) |
| 샘플과 검색 | Snowflake는 약 1–10개 distinct 값의 차원에 sample-value 검색을 권고하고, 컬럼의 실제 문자열 값을 찾는 데 Cortex Search를 통합한다. `is_enum: true`는 샘플을 가능한 값의 전체 목록으로 취급한다. | 샘플은 값 표현을 이해하는 근거다. 전체 enum이라는 근거 없이 이를 완전 목록으로 승격하지 않는다. [검색 통합](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst/cortex-analyst-search-integration), [YAML](https://docs.snowflake.com/en/user-guide/views-semantic/semantic-view-yaml-spec) |

**샘플/vector RAG의 한계 — 추론:** 유사한 설명이나 값의 검색 성공은 키 유일성, 조인 누락·중복, 전체 기간 커버리지, 금액의 가산성을 증명하지 않는다. 위 문서도 literal 검색과 관계·metric 정의를 별개로 취급한다. 따라서 검색은 후보와 값의 연결을 돕고, host의 프로파일링·관계 검사·실제 집계 검증이 결과를 판정해야 한다. 이것은 vector RAG가 항상 실패한다는 실험 결과가 아니라, 검색 결과만으로 확정할 수 없는 속성에 관한 구분이다.

예를 들어 주문 1건과 품목 3행을 조인한 뒤 주문 총액을 합산하면 총액이 3배가 될 수 있다. 몇 개 샘플에서 키 중복이 안 보이거나 “매출” 설명이 잘 검색되어도 이 위험은 사라지지 않는다. 이는 설명용 예시이며 저장소 데이터에서 관측한 오류가 아니다.

## Spider 2.0이 보여주는 난도와 해석 한계

- 논문은 기업 데이터 활용 사례에서 도출한 **632개 workflow 문제**, 종종 **1,000개 이상 컬럼**, BigQuery/Snowflake 등 여러 시스템을 다룬다. 해결에는 데이터베이스 메타데이터뿐 아니라 SQL 방언 문서와 프로젝트 코드 탐색, 여러 SQL 작성이 필요하다. 논문 초록의 o1-preview 기반 code agent 성공률 **21.3%**는 해당 실험 결과이며 현재 모델의 성능 상한이 아니다. [논문](https://arxiv.org/abs/2411.07763)
- 현재 프로젝트 사이트는 **Snow 547개, DBT 68개, Lite 547개** 설정을 별도로 제시한다. 이를 논문의 632개와 동일한 평가 모집단으로 합산·비교하면 안 된다. 사이트 소개의 17.1%와 논문 초록의 21.3%도 설정·버전을 확인하지 않고 같은 수치로 취급하지 않는다. [공식 프로젝트](https://spider2-sql.github.io/)
- **제안:** AX 평가에는 소스 선택, 필요한 중간 조인 테이블 발견, grain 보존, 시간 해석, 실행 결과의 정답 일치를 각각 포함한다. Spider 2.0은 기업형 작업의 복합성을 뒷받침하지만, AX의 host/AI 분리나 특정 vector 검색 방식의 우월성을 직접 검증한 연구는 아니다.

## AX Studio에 넘길 최소 의미 계약 — 제안

AI의 구조화 계획에는 `source_ids`, `evidence_refs`, `metric_definition`, `input_grain`, `output_grain`, `join_path`, `time_basis`, `filters`, `unresolved_questions`가 필요하다. 구체적인 API 이름이나 실행 코드를 AI가 결정해야 한다는 뜻은 아니다.

host는 식별자·권한·근거 버전을 확인하고, 필요한 조회와 키/조인 검증을 실행하며, 비용·시간 제한과 결과 기록을 관리한다. AI는 반환된 관측 근거로 의미 판단을 갱신한다. 출판 전에는 required source의 source snapshot에 묶인 근거와 required example replay를 유지한다. 마지막 조건은 저장소의 [CONTEXT](../../CONTEXT.md)와 [ADR 0001](../adr/0001-work-discovery-session-lifecycle.md)에 따른다.

검증 사례는 ① 이름은 비슷하지만 grain이 다른 소스, ② 일대다 조인의 합계 중복, ③ 주문일/결제일과 월 경계, ④ 과거 고객 속성, ⑤ 샘플에 없는 유효 코드, ⑥ 적합한 소스가 없어 clarification이 필요한 질문을 포함한다. 이번 조사는 문서 근거 정리이며 이 사례의 실행 검증이나 benchmark 재현은 수행하지 않았다.

문서 상태 주의: 조회 시 Snowflake 개요는 Cortex Agents 전환을 권고한다. 여기서는 요청 범위에 맞춰 Analyst의 의미 모델·API 계약을 조사했으며, 제품 도입 권고로 확장하지 않았다. dbt 세부 YAML은 버전별 차이가 있어 위 내용은 의미 개념을 중심으로 정리했다. [Snowflake 개요](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst), [dbt Dimensions](https://docs.getdbt.com/docs/build/dimensions)
