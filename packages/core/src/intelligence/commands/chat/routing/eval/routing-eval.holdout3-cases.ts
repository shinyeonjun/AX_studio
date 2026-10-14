import type { JevRoutingCase } from './routing-eval.cases.js';

/**
 * Third held-out set, written on 2026-10-14 by a blind author before any engine run: the author
 * saw only the case type, the scorer, the two workspace fixtures and the earlier case wording (to
 * avoid repeating it), and no results. The category quota was fixed before any request was
 * written; each group is headed by its category and count. Never edited after results.
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

export const HOLDOUT3_BASIC_CASES: readonly JevRoutingCase[] = [
  // 대화·설명 (3)
  { id: 'h3-diff-run', message: '업무랑 실행 기록은 뭐가 다른 거예요?', expect: reply },
  { id: 'h3-lunch', message: '점심 메뉴 추천 좀 해줄래?', expect: reply },
  { id: 'h3-why-ask', message: '아까 어디서 찾을지 물어본 건 왜 그런 거야?', expect: reply },
  // DB 조회 (7)
  { id: 'h3-customer-regions', message: '고객들 이름이랑 사는 지역 좀 보여줄래?', expect: dbRead('customers') },
  { id: 'h3-orders-dates', message: '주문 들어온 날짜랑 금액 같이 나오게 주문 데이터 보여줘', expect: dbRead('orders') },
  { id: 'h3-orders-state', message: '주문 건마다 처리 상태가 어떻게 되어 있는지 보고 싶어요', expect: dbRead('orders') },
  { id: 'h3-db-product-codes', message: '쇼핑몰 DB에서 상품 코드랑 이름 목록 뽑아주세요', expect: dbRead('products') },
  { id: 'h3-db-catalog', message: '내부 DB 기준으로 판매 상품 카탈로그 보여줘', expect: dbRead('products') },
  { id: 'h3-customers-table', message: 'customers 테이블 그대로 보여줘', expect: dbRead('customers') },
  { id: 'h3-orders-table', message: '쇼핑몰 DB의 주문 테이블 열어봐 줄래', expect: dbRead('orders') },
  // DB 조회 + 계산·필터·정렬 (7)
  { id: 'h3-customers-per-region', message: '지역마다 고객이 몇 명씩 있는지 세어줘', expect: dbRead('customers', calculated) },
  { id: 'h3-db-price-filter', message: '쇼핑몰 DB에 있는 상품 중 가격 3만원 이상인 것만 골라줘', expect: dbRead('products', filtered) },
  // Counterpart of h3-ambiguous-category-count: the DB is named.
  { id: 'h3-db-category-count', message: 'DB 상품을 카테고리별로 몇 개인지 세어줘', expect: dbRead('products', calculated) },
  { id: 'h3-busan-order-sum', message: '부산 고객들이 주문한 금액 다 합치면 얼마야?', expect: dbRead('orders', { join: ['customers'], ...calculated }) },
  { id: 'h3-orders-per-product', message: '상품별로 주문이 몇 번 들어왔는지 알려줘', expect: dbRead('orders', calculated) },
  { id: 'h3-top-buyers', message: '주문을 제일 많이 한 고객 이름 3명만 알려줘', expect: dbRead('orders', { join: ['customers'], tableTransform: ['calculate', 'sort', 'filter_sort'] }) },
  { id: 'h3-customers-name-sort', message: '고객 명단을 이름 가나다순으로 정렬해서 보여줘', expect: dbRead('customers', sorted) },
  // API 조회 (2)
  { id: 'h3-api-categories', message: 'DummyJSON 쪽 상품 카테고리 종류 뭐 있는지 보여줘', expect: httpRead(['products', 'products/categories']) },
  { id: 'h3-api-user-ages', message: '더미JSON 회원 나이 정보 확인하고 싶어', expect: httpRead('users') },
  // 출처가 겹쳐 되묻기 (1): 쇼핑몰 DB products and DummyJSON products both carry a category.
  { id: 'h3-ambiguous-category-count', message: '카테고리별로 상품이 몇 개씩 있는지 세어줘', expect: askWhere },
  // 메일·Slack (3)
  { id: 'h3-mail-quote', message: '거래처에서 온 견적서 메일 있는지 찾아봐', expect: mail },
  { id: 'h3-slack-today', message: '#ax테스트에서 오늘 오간 대화 보여줘', expect: { kind: ['command'], capabilityId: ['slack.messages.read', 'slack.messages.search'] } },
  { id: 'h3-mail-attachments', message: '첨부파일 붙은 메일만 최근 거 몇 개 보여줘', expect: mail },
  // 목록·기억·발송·보고서 (3)
  { id: 'h3-remember-sort', message: '내가 보는 표는 항상 최신 날짜가 위로 오게 해줘. 계속 그렇게 기억해줘', expect: remember },
  { id: 'h3-send-mail-once', message: '내 Gmail로 "내일 회의 자료 챙기기" 메모 한 번 보내줘', expect: sendOnce },
  { id: 'h3-report-quarter', message: '이번 분기 매출 보고서 하나 만들어 줘', expect: report },
  // 반복·자동 업무 만들기 (2)
  { id: 'h3-cancel-trigger', message: '취소 주문이 생길 때마다 슬랙으로 알려주는 자동 업무 만들어줘', expect: recurring },
  { id: 'h3-monthly-customers', message: '매달 말일에 신규 고객 수를 정리해서 메일로 보내주는 거 설정해줘', expect: recurring },
  // 이전 표 후속 질문 (2)
  { id: 'h3-follow-top3', previous: 'orders', message: '이 중에서 금액 큰 거 세 개만 남겨', expect: { kind: ['previous_result'] } },
  { id: 'h3-follow-average', previous: 'orders', message: '여기 나온 것들 평균 금액은?', expect: { kind: ['previous_result', 'reply'] } },
];

export const HOLDOUT3_SCALE_CASES: readonly JevRoutingCase[] = [
  // 대화·설명 (3)
  { id: 'h3s-goodnight', message: '수고했어 오늘도', expect: reply },
  { id: 'h3s-howto-db', message: '새로운 DB를 연결하려면 뭘 준비해야 하나요?', expect: reply },
  { id: 'h3s-privacy', message: '여기서 조회한 데이터가 외부로 나가지는 않죠?', expect: reply },
  // DB 조회 (15)
  { id: 'h3s-order-items', message: '주문 상세 품목 내역 보여줘', expect: read('shop', 'order_items') },
  { id: 'h3s-shop-carts', message: '쇼핑몰 고객들 장바구니에 담긴 거 보여줘', expect: read('shop', 'carts') },
  { id: 'h3s-shop-refunds', message: '쇼핑몰 환불 처리 내역 보여줘', expect: read('shop', 'refunds') },
  { id: 'h3s-routes', message: '창고에서 배송지까지 배송 경로 목록 보여줘', expect: read('logistics', 'routes') },
  { id: 'h3s-shipments', message: '물류 DB에서 출고 내역 보여줘', expect: read('logistics', 'shipments') },
  { id: 'h3s-budgets', message: '올해 부서별 예산 편성표 보여줘', expect: read('finance', 'budgets') },
  { id: 'h3s-accounts', message: '계정과목 목록 보여줘', expect: read('finance', 'accounts') },
  { id: 'h3s-leaves', message: '직원들 휴가 신청 내역 보여줘', expect: read('hr', 'leaves') },
  // Counterpart of the customer ambiguity: CRM is named.
  { id: 'h3s-crm-contacts', message: 'CRM 고객사 담당자 연락처 목록 보여줘', expect: read('crm', 'customers') },
  { id: 'h3s-purchase-orders', message: '공급처에 낸 발주 내역 보여줘', expect: read('inventory', 'purchase_orders') },
  { id: 'h3s-promotions', message: '진행했던 프로모션 목록 좀 보여주세요', expect: read('marketing', 'promotions') },
  // Counterpart of 마케팅 DB web_visits vs 웹 분석 API pageviews: the DB is named.
  { id: 'h3s-web-visits', message: '마케팅 DB 웹 방문 기록 보여줘', expect: read('marketing', 'web_visits') },
  { id: 'h3s-ticket-messages', message: '고객 문의 티켓에 오간 메시지 내용 보여줘', expect: read('support', 'ticket_messages') },
  // Counterpart of h3s-ambiguous-order-count: the ERP order master is named.
  { id: 'h3s-erp-orders', message: 'ERP 주문 마스터 보여줘', expect: read('erp', 'tb_ord_mst') },
  { id: 'h3s-erp-customers', message: 'ERP에 등록된 거래 고객 사업자번호 목록 뽑아줘', expect: read('erp', 'tb_cust_mst') },
  // DB 조회 + 계산·필터·정렬 (7)
  { id: 'h3s-grade-sales', message: '쇼핑몰 고객 등급별로 주문 금액 합계 내줘', expect: read('shop', 'orders', { join: ['customers'], ...calculated }) },
  { id: 'h3s-brand-sales', message: '브랜드별로 쇼핑몰 매출 얼마나 나왔는지 합계 내줘', expect: read('shop', ['orders', 'order_items'], { join: ['products'], ...calculated }) },
  { id: 'h3s-review-average', message: '상품별 리뷰 평점 평균 알려줘', expect: read('shop', 'reviews', calculated) },
  { id: 'h3s-warehouse-capacity', message: '수용량 큰 창고 순서대로 보여줘', expect: read('logistics', 'warehouses', sorted) },
  { id: 'h3s-deal-stages', message: 'CRM 거래를 단계별로 몇 건씩 있는지 보여줘', expect: read('crm', 'deals', calculated) },
  { id: 'h3s-warranty-reasons', message: '보증수리 청구를 사유별로 몇 건인지 집계해줘', expect: read('erp', 'tb_wrnty_clm', calculated) },
  { id: 'h3s-big-coupons', message: '할인율 20% 이상인 쿠폰만 보여줘', expect: read('shop', 'coupons', filtered) },
  // API 조회 (7)
  { id: 'h3s-placeholder-comments', message: 'JSONPlaceholder 댓글 데이터 가져와', expect: api('jsonplaceholder', 'comments') },
  { id: 'h3s-recipes', message: '레시피 목록 API로 불러와줘', expect: api('dummyjson', 'recipes') },
  { id: 'h3s-stock-alerts', message: '재고 부족 알림 뜬 품목 API에서 확인해줘', expect: api('stock-api', 'alerts') },
  { id: 'h3s-forecast', message: '내일 비 온대? 일기예보 좀 봐줘', expect: api('weather-api', 'forecast') },
  { id: 'h3s-meeting-rooms', message: '회의실 목록 확인하고 싶어', expect: api('calendar-api', 'rooms') },
  { id: 'h3s-approvals', message: '결재 올라온 문서들 보여줘', expect: api('hr-api', 'approvals') },
  { id: 'h3s-jira-sprints', message: 'Jira 이번 스프린트 정보 보여줘', expect: api('jira-api', 'sprints') },
  // 출처가 겹쳐 되묻기 (5)
  // posts: DummyJSON and JSONPlaceholder.
  { id: 'h3s-ambiguous-posts', message: '게시글 목록 보여줘', expect: askWhere },
  // users: DummyJSON and JSONPlaceholder (and 그룹웨어 members).
  { id: 'h3s-ambiguous-users', message: '사용자 목록 불러와줘', expect: askWhere },
  // stock quantities: 재고 DB stock_levels and 재고 API items.
  { id: 'h3s-ambiguous-stock', message: '품목별 현재 재고 수량 보여줘', expect: askWhere },
  // orders: 쇼핑몰 DB, 물류 DB, 주문 API, ERP DB.
  { id: 'h3s-ambiguous-order-count', message: '이번 달 주문 몇 건 들어왔는지 알려줘', expect: askWhere },
  // sales: 쇼핑몰 DB orders, ERP API sales, 매장 POS API transactions.
  { id: 'h3s-ambiguous-sales', message: '매출 데이터 보여줘', expect: askWhere },
  // 메일·Slack·폴더 (3)
  { id: 'h3s-latest-report-file', message: '월간보고 폴더에서 제일 최근 파일이 뭐야?', expect: { kind: ['command'], capabilityId: 'local_folder.list' } },
  { id: 'h3s-slack-outage', message: '슬랙에서 장애 공지 언급된 메시지 검색해줘', expect: { kind: ['command'], capabilityId: 'slack.messages.search' } },
  { id: 'h3s-mail-tax-invoice', message: '세금계산서 첨부된 메일 왔는지 확인해줘', expect: mail },
  // 목록·기억·발송·보고서 (3)
  { id: 'h3s-db-connections', message: '연결된 데이터베이스가 몇 개고 뭐뭐야?', expect: connections },
  { id: 'h3s-slack-once', message: '슬랙 #ax테스트에 "점검 끝났습니다" 한 줄 남겨줘', expect: sendOnce },
  { id: 'h3s-report-draft', message: '월간보고 폴더에 있는 지난달 보고서 참고해서 이번 달 보고서 초안 써줘', expect: report },
  // 반복·자동 업무 만들기 (3)
  { id: 'h3s-weekly-tickets', message: '매주 금요일 퇴근 전에 미해결 티켓 수를 슬랙 #ax테스트로 알려줘', expect: recurring },
  { id: 'h3s-stock-alert-trigger', message: '재고 부족 알림이 새로 뜨면 바로 메일로 보내주는 자동화 만들어줘', expect: recurring },
  { id: 'h3s-monthly-payroll', message: '매월 25일 아침에 부서별 급여 총액 정리해서 나한테 메일 줘', expect: recurring },
];
