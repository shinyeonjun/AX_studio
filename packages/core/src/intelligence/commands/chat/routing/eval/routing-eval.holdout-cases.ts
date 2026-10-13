import type { JevRoutingCase } from './routing-eval.cases.js';

/**
 * Held-out requests for the Jev vs LLM decision comparison (docs/evaluation/jev-vs-codex-decision.md).
 * The main set grew from Jev's own dogfood misses, so the host code around it is tuned to Jev;
 * these were written once, before either engine answered them, and are not edited to fit results.
 */
export const HOLDOUT_BASIC_CASES: readonly JevRoutingCase[] = [
  { id: 'h-thanks', message: '고마워!', expect: { kind: ['reply'] } },
  { id: 'h-howto', message: '업무를 자동으로 돌리려면 어떻게 해야 돼?', expect: { kind: ['reply'] } },
  { id: 'h-db-busan-customers', message: '쇼핑몰 DB 고객 중에 부산 고객만 보여줘', expect: { kind: ['command'], capabilityId: 'rdb.query.read', params: { table: 'customers' }, tableTransform: ['filter', 'filter_sort'] } },
  { id: 'h-db-status-count', message: '주문 상태별로 몇 건인지 알려줘', expect: { kind: ['command'], capabilityId: 'rdb.query.read', params: { table: 'orders' }, tableTransform: ['calculate'] } },
  { id: 'h-db-average', message: '평균 주문 금액 얼마야?', expect: { kind: ['command'], capabilityId: 'rdb.query.read', params: { table: 'orders' }, tableTransform: ['calculate'] } },
  { id: 'h-db-products', message: 'DB에 있는 상품 목록 보여줘', expect: { kind: ['command'], capabilityId: 'rdb.query.read', params: { table: 'products' } } },
  { id: 'h-api-carts', message: 'DummyJSON 장바구니 목록 가져와', expect: { kind: ['command'], capabilityId: 'http.request', params: { path: 'carts' } } },
  { id: 'h-api-users', message: 'DummyJSON 사용자 10명 보여줘', expect: { kind: ['command'], capabilityId: 'http.request', params: { path: 'users' } } },
  { id: 'h-mail-search', message: '배송 관련 메일 찾아줘', expect: { kind: ['command'], capabilityId: 'gmail.messages.search' } },
  { id: 'h-slack-search', message: '슬랙에서 배포 얘기 나온 메시지 찾아줘', expect: { kind: ['command'], capabilityId: 'slack.messages.search' } },
  { id: 'h-slack-send', message: '#ax테스트에 회의 10분 늦는다고 보내줘', expect: { kind: ['command', 'clarify'], route: ['execution_enqueue_once'] } },
  { id: 'h-follow-sum', previous: 'orders', message: '방금 표에서 금액 합계 얼마야?', expect: { kind: ['previous_result'] } },
  { id: 'h-daily-job', message: '매일 아침 8시에 어제 주문 건수를 슬랙 #ax테스트로 보내줘', expect: { kind: ['command', 'clarify'], route: ['workflow_create', 'job_propose'] } },
  { id: 'h-works', message: '지금 만들어 둔 업무 뭐 있어?', expect: { kind: ['command'], route: ['workflow_list'] } },
];

const read = (connectionId: string, table: string | string[], extra: Partial<JevRoutingCase['expect']> = {}): JevRoutingCase['expect'] =>
  ({ kind: ['command'], capabilityId: 'rdb.query.read', params: { connectionId, table }, ...extra });
const api = (connectionId: string, path: string | string[]): JevRoutingCase['expect'] =>
  ({ kind: ['command'], capabilityId: 'http.request', params: { connectionId, path } });

export const HOLDOUT_SCALE_CASES: readonly JevRoutingCase[] = [
  { id: 'hs-employees', message: '인사 DB 직원 목록 보여줘', expect: read('hr', 'employees') },
  { id: 'hs-github-pulls', message: 'GitHub 풀 리퀘스트 목록 보여줘', expect: api('github-api', 'pulls') },
  { id: 'hs-unpaid-invoices', message: '아직 돈 안 들어온 청구서 보여줘', expect: read('finance', 'invoices', { tableTransform: ['filter', 'filter_sort'] }) },
  { id: 'hs-ad-spend', message: '마케팅 DB에서 캠페인별 광고비 합계 알려줘', expect: read('marketing', ['ad_spend', 'campaigns'], { tableTransform: ['calculate'] }) },
  { id: 'hs-holidays', message: '올해 공휴일 알려줘', expect: api('holiday-api', 'holidays') },
  { id: 'hs-survey-average', message: '고객지원 만족도 점수 평균 알려줘', expect: read('support', 'satisfaction_surveys', { tableTransform: ['calculate'] }) },
  { id: 'hs-suppliers', message: '재고 DB 공급업체 목록 보여줘', expect: read('inventory', 'suppliers') },
  { id: 'hs-hr-folder', message: '인사규정 폴더에 뭐 있어?', expect: { kind: ['command'], capabilityId: 'local_folder.list' } },
  // 쇼핑몰 DB and CRM DB both keep customers: the person must be asked.
  { id: 'hs-ambiguous-customers', message: '고객 목록 보여줘', expect: { kind: ['clarify'], sourceChooser: true } },
  { id: 'hs-coin', message: '비트코인 시세 보여줘', expect: api('crypto-api', 'tickers') },
];

/**
 * Second held-out set, written on 2026-10-14 by an author who had not seen any engine results.
 * The category quota per workspace was fixed before any request was written; each group below
 * is headed by its category and count. Not edited to fit results.
 */
const dbRead = (table: string, extra: Partial<JevRoutingCase['expect']> = {}): JevRoutingCase['expect'] =>
  ({ kind: ['command'], capabilityId: 'rdb.query.read', params: { table }, ...extra });
const httpRead = (path: string): JevRoutingCase['expect'] =>
  ({ kind: ['command'], capabilityId: 'http.request', params: { path } });
const askWhere: JevRoutingCase['expect'] = { kind: ['clarify'], sourceChooser: true };
const recurring: JevRoutingCase['expect'] = { kind: ['command', 'clarify'], route: ['workflow_create', 'job_propose'] };
const connections: JevRoutingCase['expect'] = { kind: ['command'], route: ['connection_list', 'source_list', 'resource_list'] };
const remember: JevRoutingCase['expect'] = { kind: ['command', 'clarify'], route: ['context_remember'] };
const filtered = { tableTransform: ['filter', 'filter_sort'] };
const sorted = { tableTransform: ['sort', 'filter_sort'] };
const calculated = { tableTransform: ['calculate'] };

export const HOLDOUT2_BASIC_CASES: readonly JevRoutingCase[] = [
  // conversational / how-to (3)
  { id: 'h2-bye', message: '오늘은 여기까지 할게 ㅎㅎ', expect: { kind: ['reply'] } },
  { id: 'h2-howto-slack', message: '슬랙 연결은 어디서 하는 거예요?', expect: { kind: ['reply'] } },
  { id: 'h2-howto-report', message: '보고서 자동 작성은 어떻게 쓰는 거야?', expect: { kind: ['reply'] } },
  // plain read (7)
  { id: 'h2-orders-list', message: '주문 내역 쭉 뽑아줘', expect: dbRead('orders') },
  { id: 'h2-orders-shop', message: '쇼핑몰 주문 데이터 보여주세요', expect: dbRead('orders') },
  { id: 'h2-orders-casual', message: '들어온 주문들 좀 보자', expect: dbRead('orders') },
  { id: 'h2-customers-list', message: '고객 명단 보여줘', expect: dbRead('customers') },
  { id: 'h2-customers-info', message: '우리 고객 정보 다 보여줘요', expect: dbRead('customers') },
  { id: 'h2-products-table', message: '쇼핑몰 DB 상품 테이블 보여줘', expect: dbRead('products') },
  { id: 'h2-products-db', message: 'DB에 등록된 제품 리스트 줘', expect: dbRead('products') },
  // read + transform (6)
  { id: 'h2-cancel-count', message: '취소된 주문 몇 건이야?', expect: dbRead('orders', calculated) },
  { id: 'h2-month-total', message: '이번 달 주문 금액 총합 얼마나 돼?', expect: dbRead('orders', calculated) },
  { id: 'h2-recent-ten', message: '최근 주문부터 순서대로 10건 보여줘', expect: dbRead('orders', sorted) },
  { id: 'h2-seoul-count', message: '서울 고객이 몇 명이야?', expect: dbRead('customers', calculated) },
  { id: 'h2-cheapest-db', message: 'DB 상품 중에 제일 싼 거 3개만 뽑아줘', expect: dbRead('products', sorted) },
  { id: 'h2-category-avg', message: '쇼핑몰 DB 상품 카테고리별 평균 가격 알려줘', expect: dbRead('products', calculated) },
  // HTTP API read (3)
  { id: 'h2-api-users', message: '더미제이슨 유저 데이터 좀 불러와', expect: httpRead('users') },
  { id: 'h2-api-carts', message: 'API 쪽 장바구니 데이터 보여줘', expect: httpRead('carts') },
  { id: 'h2-api-products', message: 'DummyJSON 상품 리스트 20개만 가져와', expect: httpRead('products') },
  // Gmail / Slack reads (3)
  { id: 'h2-mail-unread', message: '안 읽은 메일 있으면 보여줘', expect: { kind: ['command'], capabilityId: 'gmail.messages.search' } },
  { id: 'h2-slack-channel-read', message: '#ax테스트 채널에 최근에 올라온 거 10개 보여줘', expect: { kind: ['command'], capabilityId: 'slack.messages.read' } },
  { id: 'h2-slack-channels', message: '우리 슬랙 채널 뭐뭐 있지?', expect: { kind: ['command'], capabilityId: 'slack.channels.list' } },
  // ambiguous source (2): 쇼핑몰 DB and DummyJSON both hold products with prices.
  { id: 'h2-ambiguous-products', message: '상품 목록 보여줘', expect: askWhere },
  { id: 'h2-ambiguous-price', message: '가격 비싼 상품부터 순서대로 보여줘', expect: askWhere },
  // follow-up on the previous table (2)
  { id: 'h2-follow-exclude', previous: 'orders', message: '거기서 취소된 건 빼고 보여줘', expect: { kind: ['previous_result'] } },
  // Totals over the shown table: continuing the table and answering from it are both right.
  { id: 'h2-follow-group', previous: 'orders', message: '이거 지역별로 금액 합쳐줘', expect: { kind: ['previous_result', 'reply'] } },
  // recurring / triggered workflow creation (2)
  { id: 'h2-weekly-mail', message: '매주 금요일 오후 5시에 이번 주 주문 합계를 내 메일로 보내줘', expect: recurring },
  { id: 'h2-slack-trigger', message: '슬랙에 새 메시지 올라오면 내용 정리해서 메일로 보내주는 업무 만들어줘', expect: recurring },
  // connection list / remember a preference (2)
  { id: 'h2-connected-apis', message: '지금 연결된 API 뭐 있어?', expect: connections },
  { id: 'h2-remember-date', message: '앞으로 날짜는 2026.10.14 이런 식으로 써줘. 기억해 둬', expect: remember },
];

export const HOLDOUT2_SCALE_CASES: readonly JevRoutingCase[] = [
  // conversational / how-to (3)
  { id: 'h2s-thanks', message: '고마워요, 덕분에 빨리 끝났네요', expect: { kind: ['reply'] } },
  { id: 'h2s-howto-once', message: '반복 업무랑 한 번만 실행하는 거랑 차이가 뭐야?', expect: { kind: ['reply'] } },
  { id: 'h2s-howto-folder', message: '폴더를 연결하면 파일 내용까지 다 올라가는 거예요?', expect: { kind: ['reply'] } },
  // plain read (15)
  { id: 'h2s-warehouses', message: '창고 어디어디 있는지 보여줘', expect: read('logistics', 'warehouses') },
  { id: 'h2s-carriers', message: '같이 일하는 택배사 리스트 줘', expect: read('logistics', 'carriers') },
  { id: 'h2s-payments', message: '회계 DB 결제 내역 보여줘', expect: read('finance', 'payments') },
  { id: 'h2s-tax-filings', message: '세금 신고 이력 좀 볼 수 있을까요?', expect: read('finance', 'tax_filings') },
  { id: 'h2s-trainings', message: '직원들 교육 이수 기록 보여줘', expect: read('hr', 'trainings') },
  { id: 'h2s-evaluations', message: '인사평가 점수 목록 보여줘', expect: read('hr', 'evaluations') },
  { id: 'h2s-departments', message: '회사 부서 목록 보여줘', expect: read('hr', 'departments') },
  { id: 'h2s-leads', message: 'CRM 리드 목록 보여줘', expect: read('crm', 'leads') },
  { id: 'h2s-contracts', message: '고객사랑 맺은 계약 목록 보여줘요', expect: read('crm', 'contracts') },
  { id: 'h2s-newsletter', message: '뉴스레터 구독자 명단 뽑아줘', expect: read('marketing', 'newsletter_subscribers') },
  { id: 'h2s-faq', message: 'FAQ 문서 목록 보여줘', expect: read('support', 'faq_articles') },
  { id: 'h2s-support-agents', message: '고객지원 상담원 명단 보여줘', expect: read('support', 'agents') },
  { id: 'h2s-coupons', message: '쇼핑몰 쿠폰 목록 보여줘', expect: read('shop', 'coupons') },
  { id: 'h2s-reviews', message: '상품 리뷰 올라온 거 보여줘', expect: read('shop', 'reviews') },
  { id: 'h2s-erp-tax-invoices', message: 'ERP 세금계산서 목록 보여줘', expect: read('erp', 'tb_tax_inv') },
  // read + transform (8)
  { id: 'h2s-carrier-count', message: '택배사별 배송 건수 알려줘', expect: read('logistics', 'shipments', calculated) },
  { id: 'h2s-expense-sum', message: '지난달 부서별 경비 합계 얼마야?', expect: read('finance', 'expenses', calculated) },
  { id: 'h2s-top-evaluations', message: '평가 점수 제일 높은 직원 5명 보여줘', expect: read('hr', 'evaluations', sorted) },
  { id: 'h2s-hot-leads', message: '점수 80점 넘는 리드만 보여줘', expect: read('crm', 'leads', filtered) },
  { id: 'h2s-supplier-lead-time', message: '공급업체 리드타임 긴 순으로 정렬해서 보여줘', expect: read('inventory', 'suppliers', sorted) },
  { id: 'h2s-delay-average', message: '배송 지연 평균 몇 시간이야?', expect: read('logistics', 'delivery_delays', calculated) },
  { id: 'h2s-big-contracts', message: '계약 금액 1억 넘는 계약만 보여줘', expect: read('crm', 'contracts', filtered) },
  { id: 'h2s-ticket-status', message: '고객 문의 티켓 상태별로 몇 건이야?', expect: read('support', 'tickets', calculated) },
  // HTTP API read (6)
  { id: 'h2s-headlines', message: '오늘 주요 뉴스 헤드라인 보여줘', expect: api('news-api', 'headlines') },
  { id: 'h2s-stock-quote', message: '삼성전자 주가 지금 얼마야?', expect: api('stocks-api', 'quotes') },
  { id: 'h2s-calendar', message: '사내 캘린더에 잡힌 일정 보여줘', expect: api('calendar-api', 'events') },
  { id: 'h2s-notices', message: '그룹웨어 공지 올라온 거 있어?', expect: api('hr-api', 'notices') },
  { id: 'h2s-pos-stores', message: 'POS에 등록된 매장 목록 보여줘', expect: api('pos-api', 'stores') },
  { id: 'h2s-traffic-sources', message: '웹사이트 유입 경로 데이터 가져와', expect: api('analytics-api', 'sources') },
  // Gmail / Slack / folder reads (3)
  { id: 'h2s-mail-senders', message: '어제 받은 메일들 보낸 사람이랑 제목만 정리해줘', expect: { kind: ['command'], capabilityId: 'gmail.messages.search' } },
  { id: 'h2s-slack-notice-channel', message: '#공지 채널에 최근 올라온 메시지 보여줘', expect: { kind: ['command'], capabilityId: 'slack.messages.read' } },
  { id: 'h2s-sales-folder', message: '영업자료 폴더 안에 있는 파일들 보여줘', expect: { kind: ['command'], capabilityId: 'local_folder.list' } },
  // ambiguous source (4): GitHub/Jira issues; 물류 DB/주문 API returns; 마케팅 DB/광고 API
  // campaigns (CRM campaign_contacts too); 쇼핑몰 DB/재고 DB/DummyJSON products.
  { id: 'h2s-ambiguous-issues', message: '이슈 목록 보여줘', expect: askWhere },
  { id: 'h2s-ambiguous-returns', message: '반품 목록 보여줘', expect: askWhere },
  { id: 'h2s-ambiguous-campaigns', message: '캠페인 목록 보여줘', expect: askWhere },
  { id: 'h2s-ambiguous-products', message: '상품 목록 좀 보여줘', expect: askWhere },
  // recurring / triggered workflow creation (3)
  { id: 'h2s-monthly-expense', message: '매달 1일에 지난달 부서별 경비 합계를 메일로 보내줘', expect: recurring },
  { id: 'h2s-folder-trigger', message: '영업자료 폴더에 새 파일 들어오면 슬랙 #ax테스트에 알려주는 업무 만들어줘', expect: recurring },
  { id: 'h2s-daily-fx', message: '평일 오전 9시마다 달러 환율 확인해서 #ax테스트에 올려줘', expect: recurring },
  // workflow list / connection list / remember / one-off send (4)
  { id: 'h2s-api-connections', message: '연결해 둔 API 목록 좀 보여줘', expect: connections },
  { id: 'h2s-works', message: '등록된 업무들 뭐 있는지 보자', expect: { kind: ['command'], route: ['workflow_list'] } },
  { id: 'h2s-remember-comma', message: '숫자 보여줄 때 항상 천 단위 콤마 찍어줘. 기억해', expect: remember },
  { id: 'h2s-send-once', message: "#ax테스트 채널에 '오늘 배포 완료'라고 한 번만 보내줘", expect: { kind: ['command', 'clarify'], route: ['execution_enqueue_once'] } },
];
