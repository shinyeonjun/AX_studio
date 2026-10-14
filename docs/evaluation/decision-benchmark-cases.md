# 판단 벤치마크 케이스 목록

> 자동 생성 문서입니다. 케이스를 바꾼 뒤 `node scripts/decision-benchmark-cases-doc.mjs`(packages/core)로 다시 만듭니다.
> 결과와 분석: [jev-vs-codex-decision.md](jev-vs-codex-decision.md)

## 무엇을 묻는 벤치마크인가

사용자의 채팅 요청 하나를 받았을 때 앱이 **무엇을 할지** 고르는 판단을 채점합니다.
- 고르는 것: AI 답변인지, 어떤 자료(DB 테이블, API 경로, 메일, Slack, 폴더)를 읽을지, 표를 어떻게 처리할지, 업무를 만들지, 사용자에게 되물을지
- 실제 조회나 발송은 하지 않습니다. 연결은 모두 가짜 메타데이터(이름, 컬럼, 경로)입니다.
- 채점은 `routingMiss`(routing-eval.cases.ts)로 합니다. 결과 종류가 기대 목록 안에 있어야 하고, 경로·도구·연결·테이블·경로·join·표 처리 중 **케이스에 적힌 것만** 맞으면 통과입니다. 적히지 않은 부분은 자유입니다.
- "또는"으로 적힌 것은 어느 쪽이든 정답입니다(둘 다 합리적인 경우).

## 세트

| 세트 | 건수 | 만든 방식 |
|---|---|---|
| 기존 basic / scale | 25 / 29 | 매일 도는 Jev 평가 세트. Jev가 실제로 틀린 사례를 추가하고 앱을 고쳐 통과시키며 자란 세트라 **Jev에 맞춰져 있음** |
| 홀드아웃 v1 basic / scale | 14 / 10 | 2026-10-13, 어느 엔진도 돌리기 전에 작성. 이후 수정 없음 |
| 홀드아웃 v2 basic / scale | 30 / 46 | 2026-10-14, 결과를 보지 않은 별도 작성자(에이전트)가 미리 정한 분류별 할당량대로 작성. 별도 검토 후 실행 전에 커밋 |
| 홀드아웃 v3 basic / scale | 30 / 46 | 2026-10-14, 라우터 재설계 전에 v2와 같은 방식(결과를 보지 않은 별도 작성자 + 별도 검토, 수정 0건)으로 작성하고 실행 전에 커밋. 재설계를 한 사람은 내용을 보지 않음 |

## 분류별 건수

| 분류 | 기존 | 홀드아웃 v1 | 홀드아웃 v2 | 홀드아웃 v3 | 합계 |
|---|---|---|---|---|---|
| 대화·설명 | 3 | 2 | 6 | 6 | 17 |
| DB 조회 | 12 | 3 | 22 | 22 | 59 |
| DB 조회 + 계산·필터·정렬 | 13 | 6 | 14 | 14 | 47 |
| API 조회 | 8 | 5 | 9 | 9 | 31 |
| 출처가 겹쳐 되묻기 | 3 | 1 | 6 | 6 | 16 |
| 메일·Slack·폴더 | 5 | 3 | 6 | 6 | 20 |
| 목록·기억·발송·보고서 | 5 | 2 | 6 | 6 | 19 |
| 반복·자동 업무 만들기 | 3 | 1 | 5 | 5 | 14 |
| 이전 표 후속 질문 | 2 | 1 | 2 | 2 | 7 |
| **합계** | 54 | 24 | 76 | 76 | 230 |

분류는 기대값에서 자동으로 정합니다(이 스크립트의 `category`).

## 연결 환경

### basic: 작은 팀 (요청당 판단 질문 약 28개)

- **DB 쇼핑몰 DB** (`(기본)`): `orders`, `customers`, `products`
- **API DummyJSON** (`dummyjson`): `products`, `carts`, `users`
- **Gmail**
- **Slack**

### scale: 회사 규모 (요청당 판단 질문 약 174개)

orders·customers·users처럼 같은 이름이 여러 곳에 있고, ERP 테이블은 약어 이름입니다.

- **DB 쇼핑몰 DB** (`shop`): `orders`, `customers`, `products`, `order_items`, `coupons`, `reviews`, `carts`, `refunds`
- **DB 물류 DB** (`logistics`): `shipments`, `orders`, `warehouses`, `carriers`, `delivery_delays`, `returns`, `routes`
- **DB 회계 DB** (`finance`): `invoices`, `payments`, `expenses`, `budgets`, `accounts`, `journal_entries`, `tax_filings`
- **DB 인사 DB** (`hr`): `employees`, `departments`, `leaves`, `leave_balances`, `payroll`, `trainings`, `evaluations`
- **DB CRM DB** (`crm`): `customers`, `deals`, `activities`, `leads`, `campaign_contacts`, `contracts`
- **DB 재고 DB** (`inventory`): `products`, `stock_levels`, `purchase_orders`, `suppliers`, `stock_movements`
- **DB 마케팅 DB** (`marketing`): `campaigns`, `ad_spend`, `newsletter_subscribers`, `web_visits`, `promotions`
- **DB 고객지원 DB** (`support`): `tickets`, `agents`, `ticket_messages`, `satisfaction_surveys`, `faq_articles`
- **DB ERP DB** (`erp`): `tb_ord_mst`, `tb_cust_mst`, `tb_vndr_mst`, `tb_tax_inv`, `tb_inv_txn`, `tb_wrnty_clm`, `tb_frt_rt`, `tb_emp_cert`
- **API DummyJSON** (`dummyjson`): `products`, `carts`, `users`, `posts`, `todos`, `recipes`, `quotes`
- **API JSONPlaceholder** (`jsonplaceholder`): `users`, `posts`, `comments`, `albums`, `todos`
- **API 주문 API** (`order-api`): `orders`, `orders/summary`, `returns`
- **API 재고 API** (`stock-api`): `items`, `alerts`
- **API 환율 API** (`fx-api`): `rates`, `history`
- **API 날씨 API** (`weather-api`): `forecast`, `current`
- **API 공휴일 API** (`holiday-api`): `holidays`
- **API 뉴스 API** (`news-api`): `headlines`, `search`
- **API 주식 시세 API** (`stocks-api`): `quotes`, `companies`
- **API 코인 시세 API** (`crypto-api`): `tickers`
- **API GitHub** (`github-api`): `repos`, `issues`, `pulls`
- **API Jira** (`jira-api`): `issues`, `projects`, `sprints`
- **API Notion** (`notion-api`): `pages`, `databases`
- **API 사내 캘린더** (`calendar-api`): `events`, `rooms`
- **API 그룹웨어 API** (`hr-api`): `approvals`, `notices`, `members`
- **API ERP API** (`erp-api`): `sales`, `purchases`, `vendors`
- **API 매장 POS API** (`pos-api`): `transactions`, `stores`
- **API 배송 추적 API** (`delivery-api`): `tracking`
- **API 설문 API** (`survey-api`): `surveys`, `responses`
- **API 광고 API** (`ads-api`): `campaigns`, `reports`
- **API 웹 분석 API** (`analytics-api`): `pageviews`, `sources`
- **API 번역 API** (`translate-api`): `languages`
- **API 지도 API** (`maps-api`): `places`
- **API Rick and Morty API** (`rickandmorty`): `character`, `episode`
- **API PokeAPI** (`pokeapi`): `pokemon`, `type`
- **Gmail**
- **Slack**
- **폴더**: 영업자료, 인사규정, 월간보고

## 케이스

### 기존 basic (25)

| id | 요청 | 분류 | 정답 조건 |
|---|---|---|---|
| `greeting` | 안녕 | 대화·설명 | AI 답변 |
| `capabilities` | 너는 뭘 할 수 있어? | 대화·설명 | AI 답변 |
| `db-orders` | 쇼핑몰 DB에서 주문 목록 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 테이블 `orders` |
| `db-region-sum` | 지역별 매출 합계 알려줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 테이블 `orders` · join `customers` · 표 처리 계산 |
| `db-category-sum` | 상품 카테고리별 매출 합계 보여줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 테이블 `orders` · join `products` · 표 처리 계산 |
| `db-multi-filter` | 완료된 주문 중에 5만원 넘는 것만 보여줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 테이블 `orders` · 표 처리 필터 또는 필터·정렬 |
| `db-top-amount` | 주문 금액이 가장 큰 5건 보여줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 테이블 `orders` · 표 처리 정렬 또는 필터·정렬 |
| `db-product-prices` | 쇼핑몰 DB 상품 가격 목록 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 테이블 `products` |
| `db-low-stock` | DB 상품 중 재고 10개 미만인 거 보여줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 테이블 `products` · 표 처리 필터 또는 필터·정렬 |
| `db-customer-emails` | 가입한 고객 이메일 목록 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 테이블 `customers` |
| `db-daegu-customers` | 쇼핑몰 DB 고객 중에 대구 사는 사람 보여줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 테이블 `customers` · 표 처리 필터 또는 필터·정렬 |
| `db-customer-totals` | 고객별 주문 금액 합계 알려줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 테이블 `orders` · join `customers` · 표 처리 계산 |
| `api-products` | DummyJSON에서 상품 5개 보여줘 | API 조회 | 실행 결정 · API 조회 · 경로 `products` |
| `api-top-rated` | DummyJSON 상품 중 평점 높은 순으로 10개 보여줘 | API 조회 | 실행 결정 · API 조회 · 경로 `products` · 표 처리 정렬 또는 필터·정렬 |
| `two-sources` | 화장품 상품 찾아줘 | 출처가 겹쳐 되묻기 | 되묻기 · "어디에서 찾을까요?" 선택지 |
| `gmail-recent` | 최근 메일 5개 제목만 보여줘 | 메일·Slack·폴더 | 실행 결정 · 메일 검색 |
| `slack-channels` | 슬랙 채널 목록 보여줘 | 메일·Slack·폴더 | 실행 결정 · Slack 채널 목록 |
| `connections` | 연결된 데이터 뭐 있어? | 목록·기억·발송·보고서 | 실행 결정 · 경로 연결 목록 또는 자료 목록 또는 자료 목록 |
| `works` | 내 업무 목록 보여줘 | 목록·기억·발송·보고서 | 실행 결정 · 경로 업무 목록 |
| `report-from-last-month` | 지난달 보고서야. 이번 달 걸로 써 줘 | 목록·기억·발송·보고서 | 되묻기 또는 실행 결정 · 경로 보고서 작성 |
| `recurring-report` | 매주 월요일 9시에 지역별 매출 합계를 슬랙 #ax테스트로 보내줘 | 반복·자동 업무 만들기 | 실행 결정 또는 되묻기 · 경로 업무 만들기 또는 업무 제안 |
| `mail-trigger` | Gmail로 새 메일이 오면 요약해서 슬랙으로 알려주는 업무 만들어줘 | 반복·자동 업무 만들기 | 실행 결정 또는 되묻기 · 경로 업무 만들기 또는 업무 제안 |
| `remember` | 앞으로 이 대화에서는 금액을 만원 단위로 말해줘 | 목록·기억·발송·보고서 | 실행 결정 또는 되묻기 · 경로 기억하기 |
| `follow-sort` | 방금 결과를 금액 높은 순으로 정렬해줘 _(직전 답에 주문 표(3행)가 있음)_ | 이전 표 후속 질문 | 이전 표로 답 |
| `follow-filter` | 거기서 서울만 남겨줘 _(직전 답에 주문 표(3행)가 있음)_ | 이전 표 후속 질문 | 이전 표로 답 |

### 기존 scale (29)

| id | 요청 | 분류 | 정답 조건 |
|---|---|---|---|
| `scale-greeting` | 안녕하세요 | 대화·설명 | AI 답변 |
| `scale-leave-balance` | 직원별 남은 연차 일수 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `hr` · 테이블 `leave_balances` |
| `scale-delay-reasons` | 배송 지연 사유별로 몇 건인지 알려줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 연결 `logistics` · 테이블 `delivery_delays` · 표 처리 계산 |
| `scale-shop-paid` | 쇼핑몰 주문 중에 결제 완료된 것만 보여줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 연결 `shop` · 테이블 `orders` · 표 처리 필터 또는 필터·정렬 |
| `scale-logistics-orders` | 물류 쪽 주문 목록 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `logistics` · 테이블 `orders` |
| `scale-ambiguous-orders` | 주문 목록 보여줘 | 출처가 겹쳐 되묻기 | 되묻기 · "어디에서 찾을까요?" 선택지 |
| `scale-crm-deals` | CRM에서 진행 중인 거래 금액 합계 알려줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 연결 `crm` · 테이블 `deals` · 표 처리 계산 |
| `scale-urgent-tickets` | 고객지원 티켓 중에 우선순위 높은 것만 보여줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 연결 `support` · 테이블 `tickets` · 표 처리 필터 또는 필터·정렬 |
| `scale-payroll` | 이번 달 부서별 급여 합계 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 연결 `hr` · 테이블 `payroll` 또는 `employees` · 표 처리 계산 |
| `scale-fx` | 환율 API에서 달러 환율 보여줘 | API 조회 | 실행 결정 · API 조회 · 연결 `fx-api` · 경로 `rates` 또는 `history` |
| `scale-weather` | 오늘 날씨 어때? | API 조회 | 실행 결정 · API 조회 · 연결 `weather-api` · 경로 `current` 또는 `forecast` |
| `scale-github-issues` | GitHub 이슈 목록 보여줘 | API 조회 | 실행 결정 · API 조회 · 연결 `github-api` · 경로 `issues` |
| `scale-jira-issues` | Jira 이슈 목록 보여줘 | API 조회 | 실행 결정 · API 조회 · 연결 `jira-api` · 경로 `issues` |
| `scale-dummy-users` | DummyJSON 사용자 목록 보여줘 | API 조회 | 실행 결정 · API 조회 · 연결 `dummyjson` · 경로 `users` |
| `scale-placeholder-users` | JSONPlaceholder에서 사용자 목록 가져와 | API 조회 | 실행 결정 · API 조회 · 연결 `jsonplaceholder` · 경로 `users` |
| `scale-low-stock` | 재고 부족한 상품 알려줘 | DB 조회 | 실행 결정 또는 되묻기 · DB 조회 또는 API 조회 |
| `scale-mail` | 최근 메일 5개 제목만 보여줘 | 메일·Slack·폴더 | 실행 결정 · 메일 검색 |
| `scale-slack` | 슬랙 채널 목록 보여줘 | 메일·Slack·폴더 | 실행 결정 · Slack 채널 목록 |
| `scale-folder` | 월간보고 폴더에 어떤 파일 있어? | 메일·Slack·폴더 | 실행 결정 · 폴더 파일 목록 |
| `scale-works` | 내 업무 목록 보여줘 | 목록·기억·발송·보고서 | 실행 결정 · 경로 업무 목록 |
| `scale-erp-vendors` | ERP에서 매입처 목록 보여줘 | 출처가 겹쳐 되묻기 | 되묻기 · "어디에서 찾을까요?" 선택지 |
| `scale-erp-warehouse` | 창고 입출고 이력 보여줘 | DB 조회 | 실행 결정 또는 되묻기 · DB 조회 · 연결 `erp` 또는 `inventory` |
| `scale-erp-warranty` | 보증수리 청구 들어온 거 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `erp` · 테이블 `tb_wrnty_clm` |
| `scale-erp-freight` | 지역별 운임표 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `erp` · 테이블 `tb_frt_rt` |
| `scale-erp-certs` | 직원들 자격증 만료일 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `erp` · 테이블 `tb_emp_cert` |
| `scale-remembered-orders` | 주문 목록 보여줘 _(지난 선택: "주문 목록 보여줘" → 물류 DB)_ | DB 조회 | 실행 결정 · DB 조회 · 연결 `logistics` · 테이블 `orders` |
| `scale-remembered-similar` | 이번 주 들어온 주문 몇 건이야? _(지난 선택: "주문 목록 보여줘" → 물류 DB)_ | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 연결 `logistics` · 테이블 `orders` · 표 처리 계산 또는 필터 또는 필터·정렬 |
| `scale-remembered-unrelated` | 직원별 남은 연차 일수 보여줘 _(지난 선택: "주문 목록 보여줘" → 물류 DB)_ | DB 조회 | 실행 결정 · DB 조회 · 연결 `hr` · 테이블 `leave_balances` |
| `scale-recurring` | 매주 월요일 9시에 지역별 매출 합계를 슬랙으로 보내줘 | 반복·자동 업무 만들기 | 실행 결정 또는 되묻기 · 경로 업무 만들기 또는 업무 제안 |

### 홀드아웃 v1 basic (14)

| id | 요청 | 분류 | 정답 조건 |
|---|---|---|---|
| `h-thanks` | 고마워! | 대화·설명 | AI 답변 |
| `h-howto` | 업무를 자동으로 돌리려면 어떻게 해야 돼? | 대화·설명 | AI 답변 |
| `h-db-busan-customers` | 쇼핑몰 DB 고객 중에 부산 고객만 보여줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 테이블 `customers` · 표 처리 필터 또는 필터·정렬 |
| `h-db-status-count` | 주문 상태별로 몇 건인지 알려줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 테이블 `orders` · 표 처리 계산 |
| `h-db-average` | 평균 주문 금액 얼마야? | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 테이블 `orders` · 표 처리 계산 |
| `h-db-products` | DB에 있는 상품 목록 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 테이블 `products` |
| `h-api-carts` | DummyJSON 장바구니 목록 가져와 | API 조회 | 실행 결정 · API 조회 · 경로 `carts` |
| `h-api-users` | DummyJSON 사용자 10명 보여줘 | API 조회 | 실행 결정 · API 조회 · 경로 `users` |
| `h-mail-search` | 배송 관련 메일 찾아줘 | 메일·Slack·폴더 | 실행 결정 · 메일 검색 |
| `h-slack-search` | 슬랙에서 배포 얘기 나온 메시지 찾아줘 | 메일·Slack·폴더 | 실행 결정 · Slack 메시지 검색 |
| `h-slack-send` | #ax테스트에 회의 10분 늦는다고 보내줘 | 목록·기억·발송·보고서 | 실행 결정 또는 되묻기 · 경로 한 번 실행(발송 등) |
| `h-follow-sum` | 방금 표에서 금액 합계 얼마야? _(직전 답에 주문 표(3행)가 있음)_ | 이전 표 후속 질문 | 이전 표로 답 |
| `h-daily-job` | 매일 아침 8시에 어제 주문 건수를 슬랙 #ax테스트로 보내줘 | 반복·자동 업무 만들기 | 실행 결정 또는 되묻기 · 경로 업무 만들기 또는 업무 제안 |
| `h-works` | 지금 만들어 둔 업무 뭐 있어? | 목록·기억·발송·보고서 | 실행 결정 · 경로 업무 목록 |

### 홀드아웃 v1 scale (10)

| id | 요청 | 분류 | 정답 조건 |
|---|---|---|---|
| `hs-employees` | 인사 DB 직원 목록 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `hr` · 테이블 `employees` |
| `hs-github-pulls` | GitHub 풀 리퀘스트 목록 보여줘 | API 조회 | 실행 결정 · API 조회 · 연결 `github-api` · 경로 `pulls` |
| `hs-unpaid-invoices` | 아직 돈 안 들어온 청구서 보여줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 연결 `finance` · 테이블 `invoices` · 표 처리 필터 또는 필터·정렬 |
| `hs-ad-spend` | 마케팅 DB에서 캠페인별 광고비 합계 알려줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 연결 `marketing` · 테이블 `ad_spend` 또는 `campaigns` · 표 처리 계산 |
| `hs-holidays` | 올해 공휴일 알려줘 | API 조회 | 실행 결정 · API 조회 · 연결 `holiday-api` · 경로 `holidays` |
| `hs-survey-average` | 고객지원 만족도 점수 평균 알려줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 연결 `support` · 테이블 `satisfaction_surveys` · 표 처리 계산 |
| `hs-suppliers` | 재고 DB 공급업체 목록 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `inventory` · 테이블 `suppliers` |
| `hs-hr-folder` | 인사규정 폴더에 뭐 있어? | 메일·Slack·폴더 | 실행 결정 · 폴더 파일 목록 |
| `hs-ambiguous-customers` | 고객 목록 보여줘 | 출처가 겹쳐 되묻기 | 되묻기 · "어디에서 찾을까요?" 선택지 |
| `hs-coin` | 비트코인 시세 보여줘 | API 조회 | 실행 결정 · API 조회 · 연결 `crypto-api` · 경로 `tickers` |

### 홀드아웃 v2 basic (30)

| id | 요청 | 분류 | 정답 조건 |
|---|---|---|---|
| `h2-bye` | 오늘은 여기까지 할게 ㅎㅎ | 대화·설명 | AI 답변 |
| `h2-howto-slack` | 슬랙 연결은 어디서 하는 거예요? | 대화·설명 | AI 답변 |
| `h2-howto-report` | 보고서 자동 작성은 어떻게 쓰는 거야? | 대화·설명 | AI 답변 |
| `h2-orders-list` | 주문 내역 쭉 뽑아줘 | DB 조회 | 실행 결정 · DB 조회 · 테이블 `orders` |
| `h2-orders-shop` | 쇼핑몰 주문 데이터 보여주세요 | DB 조회 | 실행 결정 · DB 조회 · 테이블 `orders` |
| `h2-orders-casual` | 들어온 주문들 좀 보자 | DB 조회 | 실행 결정 · DB 조회 · 테이블 `orders` |
| `h2-customers-list` | 고객 명단 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 테이블 `customers` |
| `h2-customers-info` | 우리 고객 정보 다 보여줘요 | DB 조회 | 실행 결정 · DB 조회 · 테이블 `customers` |
| `h2-products-table` | 쇼핑몰 DB 상품 테이블 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 테이블 `products` |
| `h2-products-db` | DB에 등록된 제품 리스트 줘 | DB 조회 | 실행 결정 · DB 조회 · 테이블 `products` |
| `h2-cancel-count` | 취소된 주문 몇 건이야? | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 테이블 `orders` · 표 처리 계산 |
| `h2-month-total` | 이번 달 주문 금액 총합 얼마나 돼? | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 테이블 `orders` · 표 처리 계산 |
| `h2-recent-ten` | 최근 주문부터 순서대로 10건 보여줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 테이블 `orders` · 표 처리 정렬 또는 필터·정렬 |
| `h2-seoul-count` | 서울 고객이 몇 명이야? | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 테이블 `customers` · 표 처리 계산 |
| `h2-cheapest-db` | DB 상품 중에 제일 싼 거 3개만 뽑아줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 테이블 `products` · 표 처리 정렬 또는 필터·정렬 |
| `h2-category-avg` | 쇼핑몰 DB 상품 카테고리별 평균 가격 알려줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 테이블 `products` · 표 처리 계산 |
| `h2-api-users` | 더미제이슨 유저 데이터 좀 불러와 | API 조회 | 실행 결정 · API 조회 · 경로 `users` |
| `h2-api-carts` | API 쪽 장바구니 데이터 보여줘 | API 조회 | 실행 결정 · API 조회 · 경로 `carts` |
| `h2-api-products` | DummyJSON 상품 리스트 20개만 가져와 | API 조회 | 실행 결정 · API 조회 · 경로 `products` |
| `h2-mail-unread` | 안 읽은 메일 있으면 보여줘 | 메일·Slack·폴더 | 실행 결정 · 메일 검색 |
| `h2-slack-channel-read` | #ax테스트 채널에 최근에 올라온 거 10개 보여줘 | 메일·Slack·폴더 | 실행 결정 · Slack 메시지 읽기 |
| `h2-slack-channels` | 우리 슬랙 채널 뭐뭐 있지? | 메일·Slack·폴더 | 실행 결정 · Slack 채널 목록 |
| `h2-ambiguous-products` | 상품 목록 보여줘 | 출처가 겹쳐 되묻기 | 되묻기 · "어디에서 찾을까요?" 선택지 |
| `h2-ambiguous-price` | 가격 비싼 상품부터 순서대로 보여줘 | 출처가 겹쳐 되묻기 | 되묻기 · "어디에서 찾을까요?" 선택지 |
| `h2-follow-exclude` | 거기서 취소된 건 빼고 보여줘 _(직전 답에 주문 표(3행)가 있음)_ | 이전 표 후속 질문 | 이전 표로 답 |
| `h2-follow-group` | 이거 지역별로 금액 합쳐줘 _(직전 답에 주문 표(3행)가 있음)_ | 이전 표 후속 질문 | 이전 표로 답 또는 AI 답변 |
| `h2-weekly-mail` | 매주 금요일 오후 5시에 이번 주 주문 합계를 내 메일로 보내줘 | 반복·자동 업무 만들기 | 실행 결정 또는 되묻기 · 경로 업무 만들기 또는 업무 제안 |
| `h2-slack-trigger` | 슬랙에 새 메시지 올라오면 내용 정리해서 메일로 보내주는 업무 만들어줘 | 반복·자동 업무 만들기 | 실행 결정 또는 되묻기 · 경로 업무 만들기 또는 업무 제안 |
| `h2-connected-apis` | 지금 연결된 API 뭐 있어? | 목록·기억·발송·보고서 | 실행 결정 · 경로 연결 목록 또는 자료 목록 또는 자료 목록 |
| `h2-remember-date` | 앞으로 날짜는 2026.10.14 이런 식으로 써줘. 기억해 둬 | 목록·기억·발송·보고서 | 실행 결정 또는 되묻기 · 경로 기억하기 |

### 홀드아웃 v2 scale (46)

| id | 요청 | 분류 | 정답 조건 |
|---|---|---|---|
| `h2s-thanks` | 고마워요, 덕분에 빨리 끝났네요 | 대화·설명 | AI 답변 |
| `h2s-howto-once` | 반복 업무랑 한 번만 실행하는 거랑 차이가 뭐야? | 대화·설명 | AI 답변 |
| `h2s-howto-folder` | 폴더를 연결하면 파일 내용까지 다 올라가는 거예요? | 대화·설명 | AI 답변 |
| `h2s-warehouses` | 창고 어디어디 있는지 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `logistics` · 테이블 `warehouses` |
| `h2s-carriers` | 같이 일하는 택배사 리스트 줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `logistics` · 테이블 `carriers` |
| `h2s-payments` | 회계 DB 결제 내역 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `finance` · 테이블 `payments` |
| `h2s-tax-filings` | 세금 신고 이력 좀 볼 수 있을까요? | DB 조회 | 실행 결정 · DB 조회 · 연결 `finance` · 테이블 `tax_filings` |
| `h2s-trainings` | 직원들 교육 이수 기록 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `hr` · 테이블 `trainings` |
| `h2s-evaluations` | 인사평가 점수 목록 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `hr` · 테이블 `evaluations` |
| `h2s-departments` | 회사 부서 목록 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `hr` · 테이블 `departments` |
| `h2s-leads` | CRM 리드 목록 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `crm` · 테이블 `leads` |
| `h2s-contracts` | 고객사랑 맺은 계약 목록 보여줘요 | DB 조회 | 실행 결정 · DB 조회 · 연결 `crm` · 테이블 `contracts` |
| `h2s-newsletter` | 뉴스레터 구독자 명단 뽑아줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `marketing` · 테이블 `newsletter_subscribers` |
| `h2s-faq` | FAQ 문서 목록 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `support` · 테이블 `faq_articles` |
| `h2s-support-agents` | 고객지원 상담원 명단 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `support` · 테이블 `agents` |
| `h2s-coupons` | 쇼핑몰 쿠폰 목록 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `shop` · 테이블 `coupons` |
| `h2s-reviews` | 상품 리뷰 올라온 거 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `shop` · 테이블 `reviews` |
| `h2s-erp-tax-invoices` | ERP 세금계산서 목록 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `erp` · 테이블 `tb_tax_inv` |
| `h2s-carrier-count` | 택배사별 배송 건수 알려줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 연결 `logistics` · 테이블 `shipments` · 표 처리 계산 |
| `h2s-expense-sum` | 지난달 부서별 경비 합계 얼마야? | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 연결 `finance` · 테이블 `expenses` · 표 처리 계산 |
| `h2s-top-evaluations` | 평가 점수 제일 높은 직원 5명 보여줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 연결 `hr` · 테이블 `evaluations` · 표 처리 정렬 또는 필터·정렬 |
| `h2s-hot-leads` | 점수 80점 넘는 리드만 보여줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 연결 `crm` · 테이블 `leads` · 표 처리 필터 또는 필터·정렬 |
| `h2s-supplier-lead-time` | 공급업체 리드타임 긴 순으로 정렬해서 보여줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 연결 `inventory` · 테이블 `suppliers` · 표 처리 정렬 또는 필터·정렬 |
| `h2s-delay-average` | 배송 지연 평균 몇 시간이야? | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 연결 `logistics` · 테이블 `delivery_delays` · 표 처리 계산 |
| `h2s-big-contracts` | 계약 금액 1억 넘는 계약만 보여줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 연결 `crm` · 테이블 `contracts` · 표 처리 필터 또는 필터·정렬 |
| `h2s-ticket-status` | 고객 문의 티켓 상태별로 몇 건이야? | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 연결 `support` · 테이블 `tickets` · 표 처리 계산 |
| `h2s-headlines` | 오늘 주요 뉴스 헤드라인 보여줘 | API 조회 | 실행 결정 · API 조회 · 연결 `news-api` · 경로 `headlines` |
| `h2s-stock-quote` | 삼성전자 주가 지금 얼마야? | API 조회 | 실행 결정 · API 조회 · 연결 `stocks-api` · 경로 `quotes` |
| `h2s-calendar` | 사내 캘린더에 잡힌 일정 보여줘 | API 조회 | 실행 결정 · API 조회 · 연결 `calendar-api` · 경로 `events` |
| `h2s-notices` | 그룹웨어 공지 올라온 거 있어? | API 조회 | 실행 결정 · API 조회 · 연결 `hr-api` · 경로 `notices` |
| `h2s-pos-stores` | POS에 등록된 매장 목록 보여줘 | API 조회 | 실행 결정 · API 조회 · 연결 `pos-api` · 경로 `stores` |
| `h2s-traffic-sources` | 웹사이트 유입 경로 데이터 가져와 | API 조회 | 실행 결정 · API 조회 · 연결 `analytics-api` · 경로 `sources` |
| `h2s-mail-senders` | 어제 받은 메일들 보낸 사람이랑 제목만 정리해줘 | 메일·Slack·폴더 | 실행 결정 · 메일 검색 |
| `h2s-slack-notice-channel` | #공지 채널에 최근 올라온 메시지 보여줘 | 메일·Slack·폴더 | 실행 결정 · Slack 메시지 읽기 |
| `h2s-sales-folder` | 영업자료 폴더 안에 있는 파일들 보여줘 | 메일·Slack·폴더 | 실행 결정 · 폴더 파일 목록 |
| `h2s-ambiguous-issues` | 이슈 목록 보여줘 | 출처가 겹쳐 되묻기 | 되묻기 · "어디에서 찾을까요?" 선택지 |
| `h2s-ambiguous-returns` | 반품 목록 보여줘 | 출처가 겹쳐 되묻기 | 되묻기 · "어디에서 찾을까요?" 선택지 |
| `h2s-ambiguous-campaigns` | 캠페인 목록 보여줘 | 출처가 겹쳐 되묻기 | 되묻기 · "어디에서 찾을까요?" 선택지 |
| `h2s-ambiguous-products` | 상품 목록 좀 보여줘 | 출처가 겹쳐 되묻기 | 되묻기 · "어디에서 찾을까요?" 선택지 |
| `h2s-monthly-expense` | 매달 1일에 지난달 부서별 경비 합계를 메일로 보내줘 | 반복·자동 업무 만들기 | 실행 결정 또는 되묻기 · 경로 업무 만들기 또는 업무 제안 |
| `h2s-folder-trigger` | 영업자료 폴더에 새 파일 들어오면 슬랙 #ax테스트에 알려주는 업무 만들어줘 | 반복·자동 업무 만들기 | 실행 결정 또는 되묻기 · 경로 업무 만들기 또는 업무 제안 |
| `h2s-daily-fx` | 평일 오전 9시마다 달러 환율 확인해서 #ax테스트에 올려줘 | 반복·자동 업무 만들기 | 실행 결정 또는 되묻기 · 경로 업무 만들기 또는 업무 제안 |
| `h2s-api-connections` | 연결해 둔 API 목록 좀 보여줘 | 목록·기억·발송·보고서 | 실행 결정 · 경로 연결 목록 또는 자료 목록 또는 자료 목록 |
| `h2s-works` | 등록된 업무들 뭐 있는지 보자 | 목록·기억·발송·보고서 | 실행 결정 · 경로 업무 목록 |
| `h2s-remember-comma` | 숫자 보여줄 때 항상 천 단위 콤마 찍어줘. 기억해 | 목록·기억·발송·보고서 | 실행 결정 또는 되묻기 · 경로 기억하기 |
| `h2s-send-once` | #ax테스트 채널에 '오늘 배포 완료'라고 한 번만 보내줘 | 목록·기억·발송·보고서 | 실행 결정 또는 되묻기 · 경로 한 번 실행(발송 등) |

### 홀드아웃 v3 basic (30)

| id | 요청 | 분류 | 정답 조건 |
|---|---|---|---|
| `h3-diff-run` | 업무랑 실행 기록은 뭐가 다른 거예요? | 대화·설명 | AI 답변 |
| `h3-lunch` | 점심 메뉴 추천 좀 해줄래? | 대화·설명 | AI 답변 |
| `h3-why-ask` | 아까 어디서 찾을지 물어본 건 왜 그런 거야? | 대화·설명 | AI 답변 |
| `h3-customer-regions` | 고객들 이름이랑 사는 지역 좀 보여줄래? | DB 조회 | 실행 결정 · DB 조회 · 테이블 `customers` |
| `h3-orders-dates` | 주문 들어온 날짜랑 금액 같이 나오게 주문 데이터 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 테이블 `orders` |
| `h3-orders-state` | 주문 건마다 처리 상태가 어떻게 되어 있는지 보고 싶어요 | DB 조회 | 실행 결정 · DB 조회 · 테이블 `orders` |
| `h3-db-product-codes` | 쇼핑몰 DB에서 상품 코드랑 이름 목록 뽑아주세요 | DB 조회 | 실행 결정 · DB 조회 · 테이블 `products` |
| `h3-db-catalog` | 내부 DB 기준으로 판매 상품 카탈로그 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 테이블 `products` |
| `h3-customers-table` | customers 테이블 그대로 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 테이블 `customers` |
| `h3-orders-table` | 쇼핑몰 DB의 주문 테이블 열어봐 줄래 | DB 조회 | 실행 결정 · DB 조회 · 테이블 `orders` |
| `h3-customers-per-region` | 지역마다 고객이 몇 명씩 있는지 세어줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 테이블 `customers` · 표 처리 계산 |
| `h3-db-price-filter` | 쇼핑몰 DB에 있는 상품 중 가격 3만원 이상인 것만 골라줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 테이블 `products` · 표 처리 필터 또는 필터·정렬 |
| `h3-db-category-count` | DB 상품을 카테고리별로 몇 개인지 세어줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 테이블 `products` · 표 처리 계산 |
| `h3-busan-order-sum` | 부산 고객들이 주문한 금액 다 합치면 얼마야? | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 테이블 `orders` · join `customers` · 표 처리 계산 |
| `h3-orders-per-product` | 상품별로 주문이 몇 번 들어왔는지 알려줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 테이블 `orders` · 표 처리 계산 |
| `h3-top-buyers` | 주문을 제일 많이 한 고객 이름 3명만 알려줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 테이블 `orders` · join `customers` · 표 처리 계산 또는 정렬 또는 필터·정렬 |
| `h3-customers-name-sort` | 고객 명단을 이름 가나다순으로 정렬해서 보여줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 테이블 `customers` · 표 처리 정렬 또는 필터·정렬 |
| `h3-api-categories` | DummyJSON 쪽 상품 카테고리 종류 뭐 있는지 보여줘 | API 조회 | 실행 결정 · API 조회 · 경로 `products` 또는 `products/categories` |
| `h3-api-user-ages` | 더미JSON 회원 나이 정보 확인하고 싶어 | API 조회 | 실행 결정 · API 조회 · 경로 `users` |
| `h3-ambiguous-category-count` | 카테고리별로 상품이 몇 개씩 있는지 세어줘 | 출처가 겹쳐 되묻기 | 되묻기 · "어디에서 찾을까요?" 선택지 |
| `h3-mail-quote` | 거래처에서 온 견적서 메일 있는지 찾아봐 | 메일·Slack·폴더 | 실행 결정 · 메일 검색 |
| `h3-slack-today` | #ax테스트에서 오늘 오간 대화 보여줘 | 메일·Slack·폴더 | 실행 결정 · Slack 메시지 읽기 또는 Slack 메시지 검색 |
| `h3-mail-attachments` | 첨부파일 붙은 메일만 최근 거 몇 개 보여줘 | 메일·Slack·폴더 | 실행 결정 · 메일 검색 |
| `h3-remember-sort` | 내가 보는 표는 항상 최신 날짜가 위로 오게 해줘. 계속 그렇게 기억해줘 | 목록·기억·발송·보고서 | 실행 결정 또는 되묻기 · 경로 기억하기 |
| `h3-send-mail-once` | 내 Gmail로 "내일 회의 자료 챙기기" 메모 한 번 보내줘 | 목록·기억·발송·보고서 | 실행 결정 또는 되묻기 · 경로 한 번 실행(발송 등) |
| `h3-report-quarter` | 이번 분기 매출 보고서 하나 만들어 줘 | 목록·기억·발송·보고서 | 실행 결정 또는 되묻기 · 경로 보고서 작성 |
| `h3-cancel-trigger` | 취소 주문이 생길 때마다 슬랙으로 알려주는 자동 업무 만들어줘 | 반복·자동 업무 만들기 | 실행 결정 또는 되묻기 · 경로 업무 만들기 또는 업무 제안 |
| `h3-monthly-customers` | 매달 말일에 신규 고객 수를 정리해서 메일로 보내주는 거 설정해줘 | 반복·자동 업무 만들기 | 실행 결정 또는 되묻기 · 경로 업무 만들기 또는 업무 제안 |
| `h3-follow-top3` | 이 중에서 금액 큰 거 세 개만 남겨 _(직전 답에 주문 표(3행)가 있음)_ | 이전 표 후속 질문 | 이전 표로 답 |
| `h3-follow-average` | 여기 나온 것들 평균 금액은? _(직전 답에 주문 표(3행)가 있음)_ | 이전 표 후속 질문 | 이전 표로 답 또는 AI 답변 |

### 홀드아웃 v3 scale (46)

| id | 요청 | 분류 | 정답 조건 |
|---|---|---|---|
| `h3s-goodnight` | 수고했어 오늘도 | 대화·설명 | AI 답변 |
| `h3s-howto-db` | 새로운 DB를 연결하려면 뭘 준비해야 하나요? | 대화·설명 | AI 답변 |
| `h3s-privacy` | 여기서 조회한 데이터가 외부로 나가지는 않죠? | 대화·설명 | AI 답변 |
| `h3s-order-items` | 주문 상세 품목 내역 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `shop` · 테이블 `order_items` |
| `h3s-shop-carts` | 쇼핑몰 고객들 장바구니에 담긴 거 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `shop` · 테이블 `carts` |
| `h3s-shop-refunds` | 쇼핑몰 환불 처리 내역 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `shop` · 테이블 `refunds` |
| `h3s-routes` | 창고에서 배송지까지 배송 경로 목록 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `logistics` · 테이블 `routes` |
| `h3s-shipments` | 물류 DB에서 출고 내역 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `logistics` · 테이블 `shipments` |
| `h3s-budgets` | 올해 부서별 예산 편성표 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `finance` · 테이블 `budgets` |
| `h3s-accounts` | 계정과목 목록 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `finance` · 테이블 `accounts` |
| `h3s-leaves` | 직원들 휴가 신청 내역 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `hr` · 테이블 `leaves` |
| `h3s-crm-contacts` | CRM 고객사 담당자 연락처 목록 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `crm` · 테이블 `customers` |
| `h3s-purchase-orders` | 공급처에 낸 발주 내역 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `inventory` · 테이블 `purchase_orders` |
| `h3s-promotions` | 진행했던 프로모션 목록 좀 보여주세요 | DB 조회 | 실행 결정 · DB 조회 · 연결 `marketing` · 테이블 `promotions` |
| `h3s-web-visits` | 마케팅 DB 웹 방문 기록 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `marketing` · 테이블 `web_visits` |
| `h3s-ticket-messages` | 고객 문의 티켓에 오간 메시지 내용 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `support` · 테이블 `ticket_messages` |
| `h3s-erp-orders` | ERP 주문 마스터 보여줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `erp` · 테이블 `tb_ord_mst` |
| `h3s-erp-customers` | ERP에 등록된 거래 고객 사업자번호 목록 뽑아줘 | DB 조회 | 실행 결정 · DB 조회 · 연결 `erp` · 테이블 `tb_cust_mst` |
| `h3s-grade-sales` | 쇼핑몰 고객 등급별로 주문 금액 합계 내줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 연결 `shop` · 테이블 `orders` · join `customers` · 표 처리 계산 |
| `h3s-brand-sales` | 브랜드별로 쇼핑몰 매출 얼마나 나왔는지 합계 내줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 연결 `shop` · 테이블 `orders` 또는 `order_items` · join `products` · 표 처리 계산 |
| `h3s-review-average` | 상품별 리뷰 평점 평균 알려줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 연결 `shop` · 테이블 `reviews` · 표 처리 계산 |
| `h3s-warehouse-capacity` | 수용량 큰 창고 순서대로 보여줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 연결 `logistics` · 테이블 `warehouses` · 표 처리 정렬 또는 필터·정렬 |
| `h3s-deal-stages` | CRM 거래를 단계별로 몇 건씩 있는지 보여줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 연결 `crm` · 테이블 `deals` · 표 처리 계산 |
| `h3s-warranty-reasons` | 보증수리 청구를 사유별로 몇 건인지 집계해줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 연결 `erp` · 테이블 `tb_wrnty_clm` · 표 처리 계산 |
| `h3s-big-coupons` | 할인율 20% 이상인 쿠폰만 보여줘 | DB 조회 + 계산·필터·정렬 | 실행 결정 · DB 조회 · 연결 `shop` · 테이블 `coupons` · 표 처리 필터 또는 필터·정렬 |
| `h3s-placeholder-comments` | JSONPlaceholder 댓글 데이터 가져와 | API 조회 | 실행 결정 · API 조회 · 연결 `jsonplaceholder` · 경로 `comments` |
| `h3s-recipes` | 레시피 목록 API로 불러와줘 | API 조회 | 실행 결정 · API 조회 · 연결 `dummyjson` · 경로 `recipes` |
| `h3s-stock-alerts` | 재고 부족 알림 뜬 품목 API에서 확인해줘 | API 조회 | 실행 결정 · API 조회 · 연결 `stock-api` · 경로 `alerts` |
| `h3s-forecast` | 내일 비 온대? 일기예보 좀 봐줘 | API 조회 | 실행 결정 · API 조회 · 연결 `weather-api` · 경로 `forecast` |
| `h3s-meeting-rooms` | 회의실 목록 확인하고 싶어 | API 조회 | 실행 결정 · API 조회 · 연결 `calendar-api` · 경로 `rooms` |
| `h3s-approvals` | 결재 올라온 문서들 보여줘 | API 조회 | 실행 결정 · API 조회 · 연결 `hr-api` · 경로 `approvals` |
| `h3s-jira-sprints` | Jira 이번 스프린트 정보 보여줘 | API 조회 | 실행 결정 · API 조회 · 연결 `jira-api` · 경로 `sprints` |
| `h3s-ambiguous-posts` | 게시글 목록 보여줘 | 출처가 겹쳐 되묻기 | 되묻기 · "어디에서 찾을까요?" 선택지 |
| `h3s-ambiguous-users` | 사용자 목록 불러와줘 | 출처가 겹쳐 되묻기 | 되묻기 · "어디에서 찾을까요?" 선택지 |
| `h3s-ambiguous-stock` | 품목별 현재 재고 수량 보여줘 | 출처가 겹쳐 되묻기 | 되묻기 · "어디에서 찾을까요?" 선택지 |
| `h3s-ambiguous-order-count` | 이번 달 주문 몇 건 들어왔는지 알려줘 | 출처가 겹쳐 되묻기 | 되묻기 · "어디에서 찾을까요?" 선택지 |
| `h3s-ambiguous-sales` | 매출 데이터 보여줘 | 출처가 겹쳐 되묻기 | 되묻기 · "어디에서 찾을까요?" 선택지 |
| `h3s-latest-report-file` | 월간보고 폴더에서 제일 최근 파일이 뭐야? | 메일·Slack·폴더 | 실행 결정 · 폴더 파일 목록 |
| `h3s-slack-outage` | 슬랙에서 장애 공지 언급된 메시지 검색해줘 | 메일·Slack·폴더 | 실행 결정 · Slack 메시지 검색 |
| `h3s-mail-tax-invoice` | 세금계산서 첨부된 메일 왔는지 확인해줘 | 메일·Slack·폴더 | 실행 결정 · 메일 검색 |
| `h3s-db-connections` | 연결된 데이터베이스가 몇 개고 뭐뭐야? | 목록·기억·발송·보고서 | 실행 결정 · 경로 연결 목록 또는 자료 목록 또는 자료 목록 |
| `h3s-slack-once` | 슬랙 #ax테스트에 "점검 끝났습니다" 한 줄 남겨줘 | 목록·기억·발송·보고서 | 실행 결정 또는 되묻기 · 경로 한 번 실행(발송 등) |
| `h3s-report-draft` | 월간보고 폴더에 있는 지난달 보고서 참고해서 이번 달 보고서 초안 써줘 | 목록·기억·발송·보고서 | 실행 결정 또는 되묻기 · 경로 보고서 작성 |
| `h3s-weekly-tickets` | 매주 금요일 퇴근 전에 미해결 티켓 수를 슬랙 #ax테스트로 알려줘 | 반복·자동 업무 만들기 | 실행 결정 또는 되묻기 · 경로 업무 만들기 또는 업무 제안 |
| `h3s-stock-alert-trigger` | 재고 부족 알림이 새로 뜨면 바로 메일로 보내주는 자동화 만들어줘 | 반복·자동 업무 만들기 | 실행 결정 또는 되묻기 · 경로 업무 만들기 또는 업무 제안 |
| `h3s-monthly-payroll` | 매월 25일 아침에 부서별 급여 총액 정리해서 나한테 메일 줘 | 반복·자동 업무 만들기 | 실행 결정 또는 되묻기 · 경로 업무 만들기 또는 업무 제안 |
