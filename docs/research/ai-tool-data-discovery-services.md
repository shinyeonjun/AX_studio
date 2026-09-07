# AI 도구·데이터 탐색 서비스 조사

- 조사일: 2026-09-05
- 범위: AX와 같은 업무 자동화 제품이 아니라, 많은 도구와 데이터에서 AI가 필요한 대상을 찾고 이해하도록 돕는 서비스·플랫폼
- 목적: AX의 핵심 경계인 `AI는 의미를 추론하고, 호스트는 안전한 인프라와 실행을 제공한다`를 구현할 때 참고할 구조를 찾는다.

## 결론

AX와 정확히 같은 완성품은 찾지 못했다. 대신 우리가 원하는 구조는 다음 제품군을 조합하면 가장 선명해진다.

1. **도구 탐색과 실행 경계:** Atlan MCP, MCP Tools/Registry
2. **데이터 자산 탐색과 관계 파악:** OpenMetadata, DataHub
3. **업무 의미와 지표 해석:** Snowflake Semantic Views, Looker LookML
4. **권한·신뢰·큐레이션:** Microsoft Purview, Databricks Unity Catalog
5. **모델 컨텍스트 확장:** Anthropic Tool Search의 deferred loading과 결과 요약 패턴

따라서 AX가 먼저 만들어야 할 것은 거대한 벡터 검색 시스템이나 AI용 만능 실행기가 아니다. **카탈로그와 Discovery Broker를 중심으로, AI가 다음에 무엇을 조사할지 선택하고 AX가 각 조사를 제한된 typed tool로 수행하는 구조**다.

## 한눈에 비교

| 참고 서비스 | 잘하는 문제 | AX가 가져올 원칙 | 그대로 가져오지 않을 것 |
|---|---|---|---|
| Atlan MCP | 자연어에서 자산 검색, 상세 조회, lineage 탐색, 읽기/쓰기 권한 분리 | 검색 결과의 GUID를 후속 호출의 안정적인 핸드오프로 사용하고, 쓰기는 미리보기·승인 후 수행 | Atlan 전체 카탈로그를 AX 안에 복제하는 것 |
| OpenMetadata | 이름·설명·컬럼·태그·용어 기반의 데이터 자산 검색과 상세 화면 | 검색·필터·스키마·샘플·프로파일·lineage를 한 자산의 서로 다른 정보 레이어로 제공 | 검색만으로 데이터 의미를 확정하는 것 |
| DataHub | schema-first metadata graph와 entity/aspect 모델 | 자산의 기본 식별자와 변화하는 metadata를 분리하고 관계 탐색을 일급 기능으로 둠 | 모든 결과를 큰 JSON으로 모델 컨텍스트에 넣는 것 |
| Snowflake Semantic Views | 물리 컬럼 위에 facts, metrics, dimensions, relationships를 정의 | 업무 용어와 물리 데이터의 매핑, grain·집계 규칙·관계 정의를 별도 계층으로 보존 | 특정 데이터웨어하우스에 종속된 semantic layer 구현 |
| Looker LookML | 모델·Explore·View·dimension·measure로 질문 가능한 영역을 제한 | AI가 무작정 DB를 훑지 않고, 사람이 정의한 업무 모델과 허용된 시작점에서 탐색 | LookML 문법 자체를 AX DSL로 복사 |
| Purview | 기술·업무·운영 metadata, 권한, lineage, 큐레이션 | 사용자가 볼 수 있는 자산만 검색하고, 신뢰된 data product를 별도 표시 | 권한을 검색 UI에서만 처리하는 것 |
| Unity Catalog | 업무 도메인/하위 도메인으로 데이터 탐색을 조직화 | catalog가 커질수록 도메인·태그·큐레이터 관점의 탐색을 제공 | 초기에 조직 전체 거버넌스 제품을 만드는 것 |
| MCP Tools/Registry | 도구 계약, 스키마, 서버/namespace 식별 | 도구 이름·입력·출력·권한·부작용을 기계적으로 검증 | 서버가 내놓은 annotation을 신뢰 경계로 삼는 것 |
| Anthropic Tool Search | 많은 도구 정의를 처음부터 컨텍스트에 넣지 않음 | 관련 도구만 늦게 로드하고, 결과를 요약해 컨텍스트를 보호 | 생성 코드 실행을 AX의 기본 실행 방식으로 채택하는 것 |

## 1. Atlan MCP: 가장 가까운 도구 탐색 레퍼런스

Atlan의 MCP 문서는 데이터 카탈로그를 AI 클라이언트가 사용하는 방식을 구체적으로 보여준다. 검색, 자산 상세 조회, 자산 타입 설명, lineage 탐색, 제한된 SQL 읽기를 각각 도구로 분리하고, 검색 후 얻은 자산 식별자를 다음 호출에 넘기는 흐름을 사용한다.

대표적인 흐름은 다음과 같다.

```text
자연어 요청
  → semantic_search / search_assets
  → 자산 GUID 확인
  → get_assets / 자산 타입 설명
  → lineage 또는 관계 탐색
  → 제한된 읽기/미리보기
  → 근거를 포함한 판단
```

특히 읽기·쓰기·관리 도구를 구분하고, 쓰기 도구는 변경 전 preview와 approval을 요구한다. 이는 AX의 `실제 데이터 변경이나 외부 전송은 하지 마` 같은 요청을 호스트 레벨에서 보장하는 데 직접적인 참고가 된다.

AX에 적용할 핵심은 Atlan의 기능 전체가 아니라 **탐색 결과의 안정적인 식별자와 다음 단계의 연결 방식**이다.

- 검색 결과는 사람이 읽는 이름만 반환하지 말고 `source_id`, `asset_id`, `version`을 반환한다.
- 다음 조회는 이름 재검색에 의존하지 않고 이전 결과의 식별자를 받는다.
- lineage 조회와 데이터 미리보기는 별도 호출로 둔다.
- 읽기 도구와 변경 도구를 다른 권한 등급으로 둔다.
- 변경 도구는 실행 전에 계획과 영향 범위를 보여주고, 승인 없이는 실행하지 않는다.

출처: [Atlan MCP tools](https://docs.atlan.com/product/capabilities/atlan-ai/references/mcp-tools), [Atlan MCP use cases](https://docs.atlan.com/product/capabilities/atlan-ai/references/mcp-chat-use-cases)

## 2. OpenMetadata: 데이터 탐색 UX의 기준

OpenMetadata의 discovery는 자산 이름뿐 아니라 설명, 컬럼, 차트, glossary, tag까지 검색 대상으로 삼고, 자산 유형과 다른 필터로 결과를 좁힌다. 자산 상세에는 스키마, 샘플 데이터, 쿼리, observability, lineage 같은 여러 정보 레이어가 존재한다.

이 구조는 AX가 연결된 DB/API를 처음부터 모두 모델 컨텍스트에 넣지 않아야 한다는 근거가 된다. AI가 먼저 넓게 검색하고, 후보가 좁혀진 뒤에만 필요한 상세와 샘플을 불러오는 **계층적 탐색**이 자연스럽다.

AX의 `describe` 결과는 최소한 다음 레이어를 구분하는 것이 좋다.

```text
검색 요약       이름, 설명, 타입, 태그, 신뢰도, 권한
구조 요약       컬럼/필드, 타입, nullable, 키, 단위 후보
프로파일        행 수, null 비율, 범위, 값 분포, 최신 시각
샘플            제한된 마스킹/읽기 전용 예시
관계            lineage, foreign key, API/DB 연결, 파생 관계
```

중요한 점은 위 정보가 같은 확실성을 갖지 않는다는 것이다. 컬럼명이 `amount`라고 해서 통화나 세금 포함 여부가 확정되는 것은 아니다. 카탈로그의 사람이 확인한 설명, 소스가 제공한 schema, 프로파일에서 관찰된 사실, AI의 가설을 별도 상태로 저장해야 한다.

출처: [OpenMetadata data discovery](https://docs.open-metadata.org/latest/how-to-guides/data-discovery/discover), [OpenMetadata table assets](https://docs.open-metadata.org/v1.12.x/api-reference/data-assets/tables)

## 3. DataHub: metadata graph와 컨텍스트 크기 관리

DataHub는 metadata를 schema-first 모델로 정의하고, entity의 식별 정보와 변화하는 aspect를 분리한다. 그 결과 자산을 검색한 뒤 기본 속성, 스키마, 소유자, lineage 같은 필요한 aspect만 선택적으로 읽을 수 있다. 검색은 키워드·필터뿐 아니라 의미 검색과 관계 탐색을 함께 제공한다.

AX에 유용한 설계 원칙은 다음이다.

- `Asset`의 정체성과 `AssetMetadata`의 변경을 분리한다.
- DB table, API endpoint, PDF template을 서로 다른 타입의 자산으로 취급한다.
- 자산 간 `produces`, `reads`, `derived_from`, `matches_template` 같은 관계를 그래프로 저장한다.
- 응답은 projection으로 필요한 필드만 반환한다.
- 검색 결과의 수와 상세 깊이를 예산으로 제한한다.

이는 “연결된 것이 많으면 AI가 모두 읽느라 timeout이 난다”는 문제에 직접 대응한다. 검색 결과 100개와 각 결과의 전체 샘플을 한 번에 반환하는 대신, 상위 후보의 식별자와 짧은 근거만 반환하고 AI가 다음 조사 행동을 선택하게 해야 한다.

출처: [DataHub metadata model](https://github.com/datahub-project/datahub/blob/master/docs/modeling/metadata-model.md), [DataHub search CLI](https://github.com/datahub-project/datahub/blob/master/docs/cli-commands/search.md)

## 4. Snowflake Semantic Views: 업무 의미를 물리 스키마에서 분리

Snowflake Semantic Views는 논리 테이블과 관계, facts, metrics, dimensions를 별도의 의미 계층으로 저장한다. 업무 언어를 물리 컬럼과 매핑하고, 동일 지표의 집계 규칙을 일관되게 유지하는 목적이다.

AX의 보고서 생성에서 가장 중요한 참고점이다. 단순히 “DB 사전과 API 필드 설명을 추가하자”만으로는 부족하다. 다음 의미가 필요하다.

- **grain:** 한 행이 주문인지, 주문 항목인지, 고객인지
- **measure:** 합계·평균·개수와 중복 제거 규칙
- **dimension:** 기간·고객·지역·상태의 분류 기준
- **relationship:** 조인 가능 키와 cardinality
- **time semantics:** 이벤트 시각, 생성 시각, 회계 기간, timezone
- **business rule:** `paid`의 의미, 취소 포함 여부, 세금·환불 처리

다만 semantic layer가 정답을 대신 결정하는 것은 아니다. AX는 카탈로그에 정의된 의미를 근거로 후보를 만들고, 관찰 데이터와 과거 보고서로 검증하고, 근거가 부족하면 질문하거나 보류해야 한다.

Snowflake의 verified query repository도 참고할 만하다. 질문과 검증된 SQL을 함께 저장하면 유사 질문의 정확도를 높일 수 있지만, 저장 전 실제 쿼리를 확인하고 실행하는 검증 단계가 필요하다. AX에서는 이를 `검증된 보고서 규칙/근거`로 일반화하면 된다.

출처: [Snowflake Semantic Views overview](https://docs.snowflake.com/en/user-guide/views-semantic/overview), [Snowflake Cortex Analyst](https://docs.snowflake.com/en/user-guide/snowflake-cortex/cortex-analyst), [Verified Query Repository](https://docs.snowflake.com/en/user-guide/views-semantic/verified-query-repository)

## 5. Looker LookML: AI가 질문할 수 있는 영역을 모델로 제한

LookML은 모델, Explore, View, field를 분리한다. 모델은 연결된 DB를 어떻게 사용할지 정하고, Explore는 사용자가 질문을 시작할 수 있는 영역이며, View와 dimension/measure는 업무적으로 어떤 필드와 집계가 가능한지 표현한다.

AX에서 가져올 원칙은 **물리 연결과 사용자에게 노출되는 업무 모델을 분리하는 것**이다.

```text
물리 source       orders 테이블, /orders API
업무 asset        결제 완료 주문
허용 시작점       월별 고객 매출
측정 규칙         amount 합계, status = paid
금지/주의         refund 중복, raw PII, write endpoint
```

이 계층이 있으면 AI가 매번 모든 컬럼을 추론하지 않아도 되고, 그래도 새로운 업무를 찾을 때는 카탈로그 검색과 프로파일을 통해 모델 바깥의 후보를 발견할 수 있다. 즉, 정적 모델은 AI를 가두는 벽이 아니라 **탐색을 빠르게 시작하는 색인과 안전한 기본 경계**다.

출처: [LookML overview](https://cloud.google.com/looker/docs/what-is-lookml), [LookML terms and concepts](https://cloud.google.com/looker/docs/lookml-terms-and-concepts)

## 6. Purview와 Unity Catalog: 신뢰·권한·도메인 구조

Microsoft Purview는 기술·업무·운영 metadata를 Data Map에 모으고, 사용자가 권한을 가진 자산만 검색 결과에 노출한다. 전체 catalog와 curated search를 구분해 신뢰된 data product를 찾기 쉽게 하는 점도 중요하다.

Unity Catalog의 Discover는 도메인과 하위 도메인으로 자산을 업무 관점에서 조직하고, 데이터 소비자와 큐레이터가 탐색하는 구조를 제공한다.

AX에 필요한 최소 적용은 다음과 같다.

- 검색 전에 권한 필터를 적용한다. 검색 후 UI에서 숨기는 방식은 충분하지 않다.
- 자산마다 owner, source, freshness, last verified, sensitivity를 가진다.
- `verified`, `observed`, `inferred`, `stale`, `blocked` 상태를 구분한다.
- 연결 수가 커지면 프로젝트·업무·도메인 scope를 검색의 첫 필터로 사용한다.
- AI가 후보를 선택할 때 신뢰 상태와 접근 불가 이유를 함께 받게 한다.

출처: [Microsoft Purview Data Map](https://learn.microsoft.com/en-us/purview/data-map), [Purview asset search](https://learn.microsoft.com/en-us/purview/unified-catalog-data-assets-search), [Databricks Unity Catalog data discovery](https://learn.microsoft.com/en-us/azure/databricks/data-governance/unity-catalog/data-discovery)

## 7. MCP Tools와 Registry: 도구 계약의 표준 경계

MCP 도구는 이름, 설명, input schema, 선택적인 output schema, 실행 관련 annotation을 명시한다. Registry는 공개 MCP server의 metadata를 모으는 역할이며, 어떤 서버가 안전하거나 신뢰된다는 판단을 대신하지 않는다.

AX의 도구 계약은 적어도 다음을 기계적으로 표현해야 한다.

```text
name / title
inputSchema / outputSchema
read_only | mutating
required_permission
estimated_cost
timeout_budget
max_rows / max_bytes
side_effects
idempotency
provenance fields
```

또한 서로 다른 서버가 같은 이름의 도구를 제공할 수 있으므로 `server_id + tool_name` 또는 AX 내부의 명시적인 namespace가 필요하다. 외부 서버가 보내는 annotation은 UX 힌트일 뿐 보안 경계로 신뢰하면 안 된다. 실제 read-only 보장, 행 제한, URL allowlist, write 차단은 AX adapter가 강제해야 한다.

출처: [MCP Tools specification](https://modelcontextprotocol.io/specification/draft/server/tools), [MCP Registry about](https://modelcontextprotocol.io/registry/about)

## 8. Anthropic Tool Search: progressive disclosure의 정확한 의미

Anthropic의 advanced tool use 문서는 도구가 많을 때 모든 도구 정의와 예시를 처음부터 모델 컨텍스트에 넣으면 토큰과 정확도가 나빠질 수 있다고 설명한다. 그래서 도구를 검색하고 관련된 정의만 늦게 로드하는 deferred loading을 제안하며, 검색에는 regex·BM25·custom search 같은 방법을 사용할 수 있다고 설명한다.

AX에 적용할 때 `progressive disclosure`는 단순한 인덱싱 기능이 아니다. 다음과 같은 **컨텍스트 로딩 정책**이다.

```text
1. 전체 카탈로그의 짧은 index만 제공
2. 요청과 관련된 자산/도구 후보만 검색
3. 후보의 schema와 설명만 로드
4. 상위 후보에 대해서만 profile/preview/lineage 로드
5. 실제 계산 계획이 확정된 뒤 필요한 원본을 제한적으로 읽음
```

이 방식은 timeout을 줄이는 데 도움이 되지만, timeout의 원인이 항상 컨텍스트 크기인 것은 아니다. 모델 응답 지연, 외부 API 지연, DB lock, PDF 변환, 단일 단계의 무제한 재시도도 별도로 측정해야 한다. 따라서 AX는 `discovery timeout`, `source read timeout`, `model timeout`, `render timeout`을 구분해 기록해야 한다.

Anthropic 문서의 programmatic tool calling은 중간 결과를 모델 컨텍스트 밖에서 처리해 오염을 줄이는 패턴으로 참고할 수 있다. 그러나 AX의 핵심 안전 경계는 생성된 코드 실행이 아니므로, 이 패턴을 그대로 도입해 AI에게 임의 코드 실행을 허용해서는 안 된다.

출처: [Anthropic advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)

## AX에 맞춘 권장 구조

```text
┌────────────────────────────────────────────────────────────┐
│ AI reasoning                                               │
│ 요구사항 이해 · 후보 비교 · 다음 조사 행동 선택 · 질문 생성 │
└───────────────────────┬────────────────────────────────────┘
                        │ typed discovery actions
┌───────────────────────▼────────────────────────────────────┐
│ Discovery Broker                                            │
│ search · describe · profile · preview · trace · read         │
│ 권한 · 비용 · timeout · 결과 크기 · side-effect 정책 집행    │
└───────────────┬───────────────────────┬─────────────────────┘
                │                       │
┌───────────────▼──────────────┐ ┌──────▼─────────────────────┐
│ Catalog / Metadata            │ │ Source adapters              │
│ DB table · API field · PDF    │ │ DB · REST · file · template  │
│ 업무 의미 · 관계 · provenance │ │ read-only contract           │
└───────────────┬──────────────┘ └──────┬─────────────────────┘
                └──────────────┬────────┘
                               ▼
┌────────────────────────────────────────────────────────────┐
│ Evidence / Snapshot                                         │
│ 실제 조회 결과 · schema fingerprint · 시점 · 근거 · redaction │
└───────────────────────┬────────────────────────────────────┘
                        ▼
┌────────────────────────────────────────────────────────────┐
│ Declarative plan + host validation                          │
│ source · transformation · template · output · no-write gate │
└───────────────────────┬────────────────────────────────────┘
                        ▼
┌────────────────────────────────────────────────────────────┐
│ Deterministic execution                                     │
│ 계산 · PDF 렌더링 · 저장/다운로드 · 승인 후 외부 전송        │
└────────────────────────────────────────────────────────────┘
```

### AI가 자유롭게 해야 하는 부분

- 요청의 목표와 기간·기준·결과물 형태 해석
- 어떤 자산을 먼저 찾을지 결정
- 검색어·alias·업무 용어 확장
- 후보 source와 template 비교
- 부족한 근거를 판단하고 질문할지 결정
- 여러 읽기 결과를 종합해 declarative plan 제안

### AX가 반드시 제한해야 하는 부분

- 어떤 source와 tool을 볼 수 있는지
- DB/API의 read-only 여부와 허용 범위
- 최대 행·바이트·응답 깊이·실행 시간
- PII/secret redaction
- 외부 URL과 write endpoint 차단
- PDF/파일 저장 경로와 파일명 정책
- 승인 전 side effect 금지
- 모든 판단 근거와 source snapshot의 provenance 기록

이렇게 하면 AI를 `무엇을 조사할지`에 대해서는 충분히 열어 두면서, `어떻게 인프라에 접근하고 무엇을 변경할지`는 호스트가 통제할 수 있다.

## AX가 저장해야 할 카탈로그 모델

현재의 DB 사전/API field description 아이디어는 맞지만, 아래 정도까지 있어야 데이터 후보를 정확히 비교할 수 있다.

```yaml
asset:
  id: stable identifier
  kind: database_table | api_endpoint | api_field | file | pdf_template
  source_id: connection or folder identity
  name: technical name
  description: human/business description
  aliases: [business terms]
  owner: optional owner
  permission: read-only | blocked | ...
  freshness: observed timestamp / expected cadence
  verification: verified | observed | inferred | stale
  sensitivity: public | internal | restricted | pii

schema:
  fields: name, type, nullable, key, unit, enum_values
  grain: one row represents ...
  time_fields: event_time, created_at, accounting_period
  relationships: target asset, key, cardinality, confidence

business_semantics:
  metrics: formula, filter, deduplication, null handling
  dimensions: meaning and allowed grouping
  status_values: business meaning of each value
  caveats: refund, timezone, tax, late arrival, known gaps

evidence:
  snapshot_id: immutable read snapshot
  observed_at: timestamp
  schema_fingerprint: hash
  query_or_request_summary: redacted summary
  sample_reference: bounded and redacted
  provenance: source and adapter version
```

`description`은 검색 품질을 높이는 정보이고, `grain`, `unit`, `time semantics`, `relationship`, `business rule`은 잘못된 보고서를 막는 검증 정보다. AI가 추론한 값은 사람이 확정한 값과 같은 필드에 덮어쓰지 말고 `hypothesis`로 보존해야 한다.

## 우선순위 제안

### 1순위: Discovery Broker의 얇은 공통 인터페이스

처음부터 검색 인프라를 크게 만들기보다, 모든 adapter가 다음 인터페이스를 제공하도록 만든다.

```text
search_assets(query, scope, filters) → compact candidates
describe_asset(asset_id, depth) → schema/meaning summary
inspect_operation(asset_id, operation_id) → API contract or table contract
profile_asset(asset_id, budget) → bounded statistics
preview_asset(asset_id, selection, budget) → redacted sample
trace_relation(asset_id, direction, depth) → bounded graph
read_asset(asset_id, selection, snapshot_policy) → immutable evidence
record_decision(evidence_ids, decision) → provenance record
```

이 인터페이스를 사용하면 AI 쪽 reasoning 방식이 바뀌어도 source adapter와 보안 정책은 재사용할 수 있다. 현재 AX에 있는 단계별 요구사항·capture plan·probe 흐름은 이 Broker의 안전한 실행 경계로 재사용할 수 있지만, 모든 조사 순서를 고정된 단계로 강제하는 최종 구조로 굳히지는 않는 편이 좋다.

### 2순위: 카탈로그와 정적 인덱스

- DB: schema, table, column, key, comment, row count/profile
- REST: method, path, parameter, response schema, example, description
- 파일/PDF: 파일 메타데이터, 페이지 수, 추출 text, 표/필드 후보, template fingerprint
- 공통: alias, 업무 용어, 권한, freshness, verification, 관계

검색은 우선 exact/alias/BM25와 필터로 시작한다. 실제 측정에서 의미 검색이 필요한 경우에만 embedding을 추가한다. “연결된 데이터가 많다”는 이유만으로 벡터 DB를 먼저 도입하면 운영 복잡도와 재현성 비용이 생긴다.

### 3순위: 컨텍스트·실행 예산과 단계별 timeout

한 번의 전체 작업에 timeout 하나만 두지 말고 각 tool call과 단계에 예산을 배분한다.

```text
discovery budget → metadata budget → profile budget
→ evidence budget → plan budget → render budget
```

각 단계는 진행률과 중간 결과를 저장하고, 실패 시 마지막 성공한 snapshot과 다음 복구 행동을 보여줘야 한다. `agent_timeout`만 표시하면 원인을 알 수 없으므로 `phase`, `tool`, `asset_id`, `elapsed_ms`, `retry_count`, `budget_remaining`을 로그에 넣는다.

### 4순위: verified semantics와 질문/보류

과거 보고서나 사람이 확인한 규칙은 검색용 예시가 아니라 검증된 업무 지식으로 저장한다. 그러나 현재 evidence로 두 후보를 구분할 수 없으면 AI가 임의로 고르지 말고 `insufficient_evidence`로 질문 또는 보류한다. hidden holdout을 실제 discovery에 노출해 통과시키는 방식은 사용하지 않는다.

## 도입하지 말아야 할 것

- AI에게 임의 SQL, 임의 URL, 임의 파일 경로, 임의 코드를 실행시키는 만능 도구
- 모든 연결의 전체 schema와 sample을 매 요청마다 모델에 넣는 방식
- column name만 보고 업무 의미를 확정하는 방식
- 검색 결과 이름을 다시 검색해 다음 단계로 넘기는 취약한 연결
- 외부 MCP server의 annotation만 보고 read-only라고 믿는 방식
- timeout을 늘리는 것만으로 탐색 문제를 해결했다고 판단하는 방식
- 특정 데모 양식이나 테스트 케이스에 맞춘 별도 매핑/하드코딩

## 최종 판단

AX의 차별점은 “AI가 모든 일을 대신한다”가 아니다. **연결된 도구와 데이터가 많아도 AI가 필요한 대상을 탐색·비교·이해할 수 있도록, 좋은 카탈로그와 안전한 탐색 도구를 제공하는 것**이다.

그러므로 DB 사전과 API field description은 좋은 출발점이지만, 핵심 구현은 다음 순서가 되어야 한다.

```text
catalog/index
  → search candidates
  → stable asset identity
  → progressive detail loading
  → profile/preview/lineage evidence
  → AI reasoning and clarification
  → declarative plan
  → host validation and deterministic execution
```

이 방향이면 AI의 의미 분석 능력을 충분히 활용하면서도, AX가 데이터 변경·외부 전송·무제한 조회를 통제할 수 있다. 다음 구현 단계는 “AI에게 더 많은 권한을 주기”가 아니라 **Discovery Broker와 자산 metadata contract를 먼저 완성하고, 현재 timeout 로그를 단계별로 관측 가능하게 만드는 것**이 가장 타당하다.

## 참고 문헌·공식 문서

- [Atlan MCP tools](https://docs.atlan.com/product/capabilities/atlan-ai/references/mcp-tools)
- [OpenMetadata data discovery](https://docs.open-metadata.org/latest/how-to-guides/data-discovery/discover)
- [DataHub metadata model](https://github.com/datahub-project/datahub/blob/master/docs/modeling/metadata-model.md)
- [Snowflake Semantic Views](https://docs.snowflake.com/en/user-guide/views-semantic/overview)
- [LookML](https://cloud.google.com/looker/docs/what-is-lookml)
- [Microsoft Purview Data Map](https://learn.microsoft.com/en-us/purview/data-map)
- [Databricks Unity Catalog data discovery](https://learn.microsoft.com/en-us/azure/databricks/data-governance/unity-catalog/data-discovery)
- [Model Context Protocol Tools](https://modelcontextprotocol.io/specification/draft/server/tools)
- [Anthropic advanced tool use](https://www.anthropic.com/engineering/advanced-tool-use)
