import type { JevRoutingCase } from './routing-eval.cases.js';

/**
 * Fourth held-out set, written on 2026-10-14 by a blind author before any engine run: the author
 * saw only the case type, the scorer, the two workspace fixtures and the earlier case wording (to
 * avoid repeating it), and no results. The category quota (the same as v3) was fixed before any
 * request was written; each group is headed by its category and count. A separate reviewer in a
 * new session checked every expectation against the fixtures: 0 expectations fixed. A second
 * reviewer, also in a new session and without results, checked every table, column, API path,
 * connectionId, source overlap and transform again — second reviewer: 0 expectations fixed.
 * Never edited after results.
 */
const dbRead = (table: string | string[], extra: Partial<JevRoutingCase['expect']> = {}): JevRoutingCase['expect'] =>
  ({ kind: ['command'], capabilityId: 'rdb.query.read', params: { table }, ...extra });
const read = (connectionId: string, table: string | string[], extra: Partial<JevRoutingCase['expect']> = {}): JevRoutingCase['expect'] =>
  ({ kind: ['command'], capabilityId: 'rdb.query.read', params: { connectionId, table }, ...extra });
const httpRead = (path: string | string[]): JevRoutingCase['expect'] =>
  ({ kind: ['command'], capabilityId: 'http.request', params: { path } });
const api = (connectionId: string, path: string | string[]): JevRoutingCase['expect'] =>
  ({ kind: ['command'], capabilityId: 'http.request', params: { connectionId, path } });
const reply: JevRoutingCase['expect'] = { kind: ['reply'] };
const askWhere: JevRoutingCase['expect'] = { kind: ['clarify'], sourceChooser: true };
const recurring: JevRoutingCase['expect'] = { kind: ['command', 'clarify'], route: ['workflow_create', 'job_propose'] };
const connections: JevRoutingCase['expect'] = { kind: ['command'], route: ['connection_list', 'source_list', 'resource_list'] };
const remember: JevRoutingCase['expect'] = { kind: ['command', 'clarify'], route: ['context_remember'] };
const sendOnce: JevRoutingCase['expect'] = { kind: ['command', 'clarify'], route: ['execution_enqueue_once'] };
const report: JevRoutingCase['expect'] = { kind: ['command', 'clarify'], route: ['report_generate'] };
const mail: JevRoutingCase['expect'] = { kind: ['command'], capabilityId: 'gmail.messages.search' };
const filtered = { tableTransform: ['filter', 'filter_sort'] };
const sorted = { tableTransform: ['sort', 'filter_sort'] };
const calculated = { tableTransform: ['calculate'] };

export const HOLDOUT4_BASIC_CASES: readonly JevRoutingCase[] = [
  // 대화·설명 (3)
  { id: 'h4-what-is-jev', message: '근데 Jev가 정확히 뭐 하는 애야?', expect: reply },
  { id: 'h4-tired', message: '아 오늘 진짜 피곤하다...', expect: reply },
  { id: 'h4-excel-question', message: '조회한 표를 엑셀 파일로도 받을 수 있나요?', expect: reply },
  // DB 조회 (7)
  { id: 'h4-who-ordered', message: '누가 뭘 주문했는지 주문 기록 좀 볼게요', expect: dbRead('orders') },
  { id: 'h4-orders-raw', message: 'orders 데이터 raw로 한번 보여줘봐', expect: dbRead('orders') },
  { id: 'h4-orders-codes', message: '주문번호랑 상품코드 매칭된 주문 내역 보여주세요', expect: dbRead('orders') },
  { id: 'h4-customer-listup', message: '쇼핑몰 고객 리스트업 해줘', expect: dbRead('customers') },
  { id: 'h4-customer-where', message: '고객별 거주 지역 정리된 거 있어? 보여줘', expect: dbRead('customers') },
  { id: 'h4-db-items-kind', message: '우리 DB에 올라간 상품들 이름이랑 분류 같이 보여줘', expect: dbRead('products') },
  { id: 'h4-db-products-query', message: '쇼핑몰 데이터베이스 products 테이블 조회해줘', expect: dbRead('products') },
  // DB 조회 + 계산·필터·정렬 (7)
  { id: 'h4-unfinished-orders', message: '아직 처리 안 끝난 주문만 추려줘', expect: dbRead('orders', filtered) },
  { id: 'h4-daily-order-count', message: '날짜별 주문 건수 집계 부탁해요', expect: dbRead('orders', calculated) },
  { id: 'h4-top-region', message: '고객 제일 많은 지역이 어디야?', expect: dbRead('customers', { tableTransform: ['calculate', 'sort', 'filter_sort'] }) },
  { id: 'h4-db-under-10k', message: 'DB 상품 중에 만원 이하짜리만 보여줘', expect: dbRead('products', filtered) },
  { id: 'h4-db-price-sort', message: '쇼핑몰 DB 상품들 price 높은 거부터 sort 해서 보여줘', expect: dbRead('products', sorted) },
  { id: 'h4-code-revenue', message: '상품코드별로 매출 합계 좀 뽑아줄래?', expect: dbRead('orders', calculated) },
  { id: 'h4-seoul-orders', message: '서울 사는 고객들 주문만 따로 보여줘', expect: dbRead('orders', { join: ['customers'], ...filtered }) },
  // API 조회 (2)
  { id: 'h4-api-carts-call', message: 'dummyjson carts 엔드포인트 호출해서 보여줘', expect: httpRead('carts') },
  { id: 'h4-api-user-emails', message: 'DummyJSON에 있는 유저들 이메일 주소 쭉 보고 싶어요', expect: httpRead('users') },
  // 출처가 겹쳐 되묻기 (1): 쇼핑몰 DB products and DummyJSON products both carry names and prices.
  { id: 'h4-ambiguous-price-list', message: '판매 중인 아이템들 가격표 좀 뽑아줘', expect: askWhere },
  // 메일·Slack (3)
  { id: 'h4-mail-from-lead', message: '팀장님이 보낸 메일 중에 이번 주 거 찾아줘', expect: mail },
  { id: 'h4-slack-mention', message: '슬랙에서 나 멘션된 메시지 있나 찾아봐', expect: { kind: ['command'], capabilityId: 'slack.messages.search' } },
  { id: 'h4-mail-flight', message: '항공권 예약 확인 메일 어디 갔지? 찾아줘', expect: mail },
  // 목록·기억·발송·보고서 (3)
  { id: 'h4-remember-name', message: '나 부를 때 연준님이라고 불러줘. 기억해 둬', expect: remember },
  { id: 'h4-slack-build-once', message: 'ax테스트 채널에 지금 바로 "빌드 깨졌어요 확인 부탁" 메시지 하나 쏴줘', expect: sendOnce },
  { id: 'h4-report-last-week', message: '지난주 주문 현황 정리한 보고서 작성해줘', expect: report },
  // 반복·자동 업무 만들기 (2)
  { id: 'h4-daily-mail-digest', message: '매일 저녁 6시마다 오늘 들어온 메일 요약해서 슬랙 #ax테스트에 올려줘', expect: recurring },
  { id: 'h4-new-order-alert', message: '새 주문 들어오면 그때그때 내 Gmail로 알림 보내게 해줘', expect: recurring },
  // 이전 표 후속 질문 (2)
  { id: 'h4-follow-cancelled', previous: 'orders', message: '여기서 취소 상태인 것만 보여줄래', expect: { kind: ['previous_result'] } },
  { id: 'h4-follow-rows', previous: 'orders', message: '방금 나온 표 몇 줄이야?', expect: { kind: ['previous_result', 'reply'] } },
];

export const HOLDOUT4_SCALE_CASES: readonly JevRoutingCase[] = [
  // 대화·설명 (3)
  { id: 'h4s-bored', message: '심심한데 재밌는 얘기 하나 해줘', expect: reply },
  { id: 'h4s-report-format', message: '보고서 만들 때 참고 파일은 어떤 형식으로 올려야 돼?', expect: reply },
  { id: 'h4s-api-key', message: 'API 키는 어디에 저장되는 거예요?', expect: reply },
  // DB 조회 (15)
  { id: 'h4s-journal', message: '회계 분개 전표 내역 좀 보여줘', expect: read('finance', 'journal_entries') },
  { id: 'h4s-crm-activities', message: '고객사 영업 활동 기록(통화, 미팅 같은 거) 보여줘', expect: read('crm', 'activities') },
  { id: 'h4s-stock-movements', message: '재고 DB에서 입출고 변동 이력 보여줘', expect: read('inventory', 'stock_movements') },
  { id: 'h4s-payroll', message: '인사 DB 급여 지급 내역 보여줘', expect: read('hr', 'payroll') },
  { id: 'h4s-campaign-contacts', message: 'CRM에서 캠페인 대상 고객들 응답했는지 여부 보여줘', expect: read('crm', 'campaign_contacts') },
  { id: 'h4s-invoices', message: '회계 쪽에서 발행한 인보이스 목록 보여줘', expect: read('finance', 'invoices') },
  { id: 'h4s-satisfaction', message: '티켓 처리 후 받은 만족도 점수랑 코멘트 보여줘', expect: read('support', 'satisfaction_surveys') },
  { id: 'h4s-freight-bands', message: '무게 구간별 배송 운임 요율 보여줘', expect: read('erp', 'tb_frt_rt') },
  { id: 'h4s-shop-grades', message: '쇼핑몰 고객들 회원 등급이랑 가입일 보여줘', expect: read('shop', 'customers') },
  { id: 'h4s-shop-brands', message: '쇼핑몰에 등록된 상품들 브랜드랑 가격 같이 보여줘', expect: read('shop', 'products') },
  { id: 'h4s-employees', message: '인사 DB 직원들 입사일이랑 직급 보여줘', expect: read('hr', 'employees') },
  { id: 'h4s-deals', message: 'CRM 파이프라인에 있는 딜들 쭉 보여줘', expect: read('crm', 'deals') },
  { id: 'h4s-ad-spend', message: '마케팅 DB 광고비 지출 기록 보여줘', expect: read('marketing', 'ad_spend') },
  { id: 'h4s-carrier-sla', message: '택배사들 SLA 기준 일수 확인하고 싶어', expect: read('logistics', 'carriers') },
  { id: 'h4s-delays', message: '배송 늦어진 건들 상세 기록 보여줘', expect: read('logistics', 'delivery_delays') },
  // DB 조회 + 계산·필터·정렬 (7)
  { id: 'h4s-overdue-sum', message: '결제기한 넘긴 인보이스 금액 다 합치면 얼마야?', expect: read('finance', 'invoices', calculated) },
  { id: 'h4s-leave-type-days', message: '휴가 종류별로 사용 일수 합계 내줘', expect: read('hr', 'leaves', calculated) },
  { id: 'h4s-warehouse-city', message: '도시별로 창고가 몇 개씩 있어?', expect: read('logistics', 'warehouses', calculated) },
  { id: 'h4s-low-reviews', message: '평점 2점 이하 리뷰만 골라줘', expect: read('shop', 'reviews', filtered) },
  { id: 'h4s-payment-method', message: '회계 쪽 결제 내역을 결제 수단별로 금액 합계 내줘', expect: read('finance', 'payments', calculated) },
  { id: 'h4s-agents-by-team', message: '상담원 팀별 인원수 알려줘', expect: read('support', 'agents', calculated) },
  { id: 'h4s-faq-views', message: '조회수 높은 FAQ 순서대로 10개 보여줘', expect: read('support', 'faq_articles', sorted) },
  // API 조회 (7)
  { id: 'h4s-albums', message: 'JSONPlaceholder 앨범 리스트 불러와', expect: api('jsonplaceholder', 'albums') },
  { id: 'h4s-notion-pages', message: '노션 페이지들 뭐 있는지 가져와줘', expect: api('notion-api', 'pages') },
  { id: 'h4s-tracking', message: '송장번호로 배송 추적 현황 API에서 조회해줘', expect: api('delivery-api', 'tracking') },
  { id: 'h4s-languages', message: '번역기에서 지원하는 언어 뭐뭐야?', expect: api('translate-api', 'languages') },
  { id: 'h4s-pokemon-types', message: '포켓몬 타입 종류 좀 보여줘', expect: api('pokeapi', 'type') },
  { id: 'h4s-erp-purchases', message: 'ERP 매입 내역 API로 가져와', expect: api('erp-api', 'purchases') },
  { id: 'h4s-github-repos', message: '깃허브 저장소 목록 좀', expect: api('github-api', 'repos') },
  // 출처가 겹쳐 되묻기 (5)
  // todos: DummyJSON and JSONPlaceholder.
  { id: 'h4s-ambiguous-todos', message: '투두 리스트 데이터 가져와', expect: askWhere },
  // customers with a region: 쇼핑몰 DB and CRM DB.
  { id: 'h4s-ambiguous-customer-regions', message: '고객 분포를 지역 기준으로 보고 싶어', expect: askWhere },
  // suppliers: 재고 DB suppliers, ERP DB tb_vndr_mst, ERP API vendors.
  { id: 'h4s-ambiguous-partners', message: '협력업체 리스트 보여줘', expect: askWhere },
  // page visits: 마케팅 DB web_visits and 웹 분석 API pageviews.
  { id: 'h4s-ambiguous-pageviews', message: '페이지별 방문수 보여줘', expect: askWhere },
  // carts: 쇼핑몰 DB carts and DummyJSON carts.
  { id: 'h4s-ambiguous-carts', message: '장바구니 데이터 좀 불러와', expect: askWhere },
  // 메일·Slack·폴더 (3)
  { id: 'h4s-sales-folder-count', message: '영업자료 폴더 안 문서들 몇 개나 있어?', expect: { kind: ['command'], capabilityId: 'local_folder.list' } },
  { id: 'h4s-slack-general', message: 'slack #general 채널 최근 대화 읽어줘', expect: { kind: ['command'], capabilityId: ['slack.messages.read', 'slack.messages.search'] } },
  { id: 'h4s-mail-tax-settlement', message: '인사팀에서 온 메일 중 연말정산 관련된 거 찾아줘', expect: mail },
  // 목록·기억·발송·보고서 (3)
  { id: 'h4s-connected-folders', message: '지금 연결돼 있는 폴더들 뭐 있지?', expect: connections },
  { id: 'h4s-remember-kst', message: '시간은 항상 한국 시간 기준으로 보여줘. 이거 기억해', expect: remember },
  { id: 'h4s-report-hiring', message: '인사 DB 데이터로 상반기 채용 현황 보고서 만들어줘', expect: report },
  // 반복·자동 업무 만들기 (3)
  { id: 'h4s-biweekly-leads', message: '격주 수요일마다 CRM 신규 리드 수 집계해서 슬랙 #ax테스트에 공유해줘', expect: recurring },
  { id: 'h4s-urgent-ticket-trigger', message: '우선순위 높은 티켓이 새로 생기면 즉시 슬랙으로 알려주는 거 만들어줘', expect: recurring },
  { id: 'h4s-nightly-coin', message: '매일 밤 11시에 비트코인 시세 체크해서 메일 보내줘', expect: recurring },
];
