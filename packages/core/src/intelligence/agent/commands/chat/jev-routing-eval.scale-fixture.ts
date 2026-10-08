/**
 * A large synthetic workspace for the routing evaluation: what a mid-size company connects once
 * AX Studio is in daily use. Only metadata (names, columns, relations) — nothing is read.
 * Names deliberately collide across sources (orders, customers, products, users) the way real
 * companies' systems do, so the evaluation sees the hard cases, not just the size.
 */
type Table = { table: string; columns: string[]; uniqueColumns?: string[] };
type Relation = { from: { table: string; column: string }; to: { table: string; column: string }; declared: boolean };

function rdb(label: string, tables: Table[], relations: Array<[string, string, string, string]> = []) {
  return {
    connector: 'rdb',
    connected: true,
    config: {
      type: 'postgres',
      label,
      allowedTables: tables.map((table) => table.table),
      schema: {
        tables: tables.map((table) => ({ uniqueColumns: ['id'], ...table })),
        relations: relations.map(([fromTable, fromColumn, toTable, toColumn]): Relation => ({
          from: { table: fromTable, column: fromColumn }, to: { table: toTable, column: toColumn }, declared: true,
        })),
      },
    },
  };
}

const t = (table: string, ...columns: string[]): Table => ({ table, columns: ['id', ...columns] });

const DATABASES = [
  rdb('쇼핑몰 DB', [
    t('orders', 'customer_id', 'product_id', 'amount', 'status', 'ordered_at'),
    t('customers', 'name', 'region', 'grade', 'joined_at'),
    t('products', 'name', 'category', 'price', 'brand'),
    t('order_items', 'order_id', 'product_id', 'quantity', 'unit_price'),
    t('coupons', 'code', 'discount_rate', 'expires_at'),
    t('reviews', 'product_id', 'customer_id', 'rating', 'body', 'created_at'),
    t('carts', 'customer_id', 'product_id', 'quantity', 'added_at'),
    t('refunds', 'order_id', 'reason', 'amount', 'refunded_at'),
  ], [['orders', 'customer_id', 'customers', 'id'], ['orders', 'product_id', 'products', 'id'], ['order_items', 'order_id', 'orders', 'id'],
    ['reviews', 'product_id', 'products', 'id'], ['refunds', 'order_id', 'orders', 'id']]),
  rdb('물류 DB', [
    t('shipments', 'order_no', 'carrier', 'status', 'shipped_at', 'delivered_at'),
    t('orders', 'order_no', 'warehouse_id', 'destination', 'weight_kg'),
    t('warehouses', 'name', 'city', 'capacity'),
    t('carriers', 'name', 'contact', 'sla_days'),
    t('delivery_delays', 'shipment_id', 'reason', 'delay_hours'),
    t('returns', 'shipment_id', 'reason', 'received_at'),
    t('routes', 'warehouse_id', 'destination', 'distance_km'),
  ], [['shipments', 'carrier', 'carriers', 'id'], ['orders', 'warehouse_id', 'warehouses', 'id'], ['delivery_delays', 'shipment_id', 'shipments', 'id']]),
  rdb('회계 DB', [
    t('invoices', 'customer_name', 'amount', 'issued_at', 'due_at', 'paid'),
    t('payments', 'invoice_id', 'amount', 'paid_at', 'method'),
    t('expenses', 'department', 'category', 'amount', 'spent_at'),
    t('budgets', 'department', 'year', 'amount'),
    t('accounts', 'code', 'name', 'type'),
    t('journal_entries', 'account_id', 'debit', 'credit', 'posted_at'),
    t('tax_filings', 'period', 'amount', 'filed_at'),
  ], [['payments', 'invoice_id', 'invoices', 'id'], ['journal_entries', 'account_id', 'accounts', 'id']]),
  rdb('인사 DB', [
    t('employees', 'name', 'department', 'position', 'hired_at', 'email'),
    t('departments', 'name', 'head_id', 'location'),
    t('leaves', 'employee_id', 'type', 'start_date', 'end_date', 'days'),
    t('leave_balances', 'employee_id', 'year', 'remaining_days'),
    t('payroll', 'employee_id', 'month', 'base_salary', 'bonus'),
    t('trainings', 'employee_id', 'course', 'completed_at'),
    t('evaluations', 'employee_id', 'period', 'score'),
  ], [['leaves', 'employee_id', 'employees', 'id'], ['leave_balances', 'employee_id', 'employees', 'id'], ['payroll', 'employee_id', 'employees', 'id']]),
  rdb('CRM DB', [
    t('customers', 'company', 'contact_name', 'email', 'region', 'tier'),
    t('deals', 'customer_id', 'stage', 'amount', 'expected_close'),
    t('activities', 'customer_id', 'type', 'note', 'occurred_at'),
    t('leads', 'source', 'company', 'score', 'created_at'),
    t('campaign_contacts', 'campaign', 'customer_id', 'responded'),
    t('contracts', 'customer_id', 'start_date', 'end_date', 'value'),
  ], [['deals', 'customer_id', 'customers', 'id'], ['activities', 'customer_id', 'customers', 'id'], ['contracts', 'customer_id', 'customers', 'id']]),
  rdb('재고 DB', [
    t('products', 'sku', 'name', 'category', 'unit_cost'),
    t('stock_levels', 'product_id', 'warehouse', 'quantity', 'updated_at'),
    t('purchase_orders', 'supplier_id', 'product_id', 'quantity', 'ordered_at'),
    t('suppliers', 'name', 'country', 'lead_time_days'),
    t('stock_movements', 'product_id', 'change', 'reason', 'moved_at'),
  ], [['stock_levels', 'product_id', 'products', 'id'], ['purchase_orders', 'supplier_id', 'suppliers', 'id'], ['purchase_orders', 'product_id', 'products', 'id']]),
  rdb('마케팅 DB', [
    t('campaigns', 'name', 'channel', 'budget', 'start_date', 'end_date'),
    t('ad_spend', 'campaign_id', 'date', 'spend', 'clicks', 'impressions'),
    t('newsletter_subscribers', 'email', 'subscribed_at', 'status'),
    t('web_visits', 'page', 'visits', 'date'),
    t('promotions', 'name', 'discount', 'starts_at'),
  ], [['ad_spend', 'campaign_id', 'campaigns', 'id']]),
  rdb('고객지원 DB', [
    t('tickets', 'customer_email', 'subject', 'status', 'priority', 'created_at', 'resolved_at'),
    t('agents', 'name', 'team'),
    t('ticket_messages', 'ticket_id', 'author', 'body', 'sent_at'),
    t('satisfaction_surveys', 'ticket_id', 'score', 'comment'),
    t('faq_articles', 'title', 'views', 'updated_at'),
  ], [['ticket_messages', 'ticket_id', 'tickets', 'id'], ['satisfaction_surveys', 'ticket_id', 'tickets', 'id']]),
];

const endpoint = (id: string, label: string, operations: Array<[string, string]>) => ({
  id, baseUrl: `https://${id}.example.test/`, label, authType: 'none',
  discoveredReadOperations: operations.map(([path, opLabel]) => ({ path, label: opLabel })),
});

const API_ENDPOINTS = [
  endpoint('dummyjson', 'DummyJSON', [['products', 'Products'], ['carts', 'Carts'], ['users', 'Users'], ['posts', 'Posts'], ['todos', 'Todos'], ['recipes', 'Recipes'], ['quotes', 'Quotes']]),
  endpoint('jsonplaceholder', 'JSONPlaceholder', [['users', 'Users'], ['posts', 'Posts'], ['comments', 'Comments'], ['albums', 'Albums'], ['todos', 'Todos']]),
  endpoint('order-api', '주문 API', [['orders', '주문 목록'], ['orders/summary', '주문 요약'], ['returns', '반품 목록']]),
  endpoint('stock-api', '재고 API', [['items', '재고 품목'], ['alerts', '재고 부족 알림']]),
  endpoint('fx-api', '환율 API', [['rates', '환율'], ['history', '환율 기록']]),
  endpoint('weather-api', '날씨 API', [['forecast', '일기예보'], ['current', '현재 날씨']]),
  endpoint('holiday-api', '공휴일 API', [['holidays', '공휴일 목록']]),
  endpoint('news-api', '뉴스 API', [['headlines', '헤드라인'], ['search', '기사 검색']]),
  endpoint('stocks-api', '주식 시세 API', [['quotes', '시세'], ['companies', '상장사']]),
  endpoint('crypto-api', '코인 시세 API', [['tickers', '코인 시세']]),
  endpoint('github-api', 'GitHub', [['repos', '저장소'], ['issues', '이슈'], ['pulls', '풀 리퀘스트']]),
  endpoint('jira-api', 'Jira', [['issues', '이슈'], ['projects', '프로젝트'], ['sprints', '스프린트']]),
  endpoint('notion-api', 'Notion', [['pages', '페이지'], ['databases', '데이터베이스']]),
  endpoint('calendar-api', '사내 캘린더', [['events', '일정'], ['rooms', '회의실']]),
  endpoint('hr-api', '그룹웨어 API', [['approvals', '결재 문서'], ['notices', '공지사항'], ['members', '구성원']]),
  endpoint('erp-api', 'ERP API', [['sales', '매출'], ['purchases', '매입'], ['vendors', '거래처']]),
  endpoint('pos-api', '매장 POS API', [['transactions', '매장 거래'], ['stores', '매장 목록']]),
  endpoint('delivery-api', '배송 추적 API', [['tracking', '배송 추적']]),
  endpoint('survey-api', '설문 API', [['surveys', '설문'], ['responses', '응답']]),
  endpoint('ads-api', '광고 API', [['campaigns', '광고 캠페인'], ['reports', '광고 성과']]),
  endpoint('analytics-api', '웹 분석 API', [['pageviews', '페이지뷰'], ['sources', '유입 경로']]),
  endpoint('translate-api', '번역 API', [['languages', '지원 언어']]),
  endpoint('maps-api', '지도 API', [['places', '장소 검색']]),
  endpoint('rickandmorty', 'Rick and Morty API', [['character', 'Characters'], ['episode', 'Episodes']]),
  endpoint('pokeapi', 'PokeAPI', [['pokemon', 'Pokemon'], ['type', 'Types']]),
];

const DATABASE_IDS = ['shop', 'logistics', 'finance', 'hr', 'crm', 'inventory', 'marketing', 'support'];

/** The eight systems as eight databases of the one 'rdb' connection, names colliding as in life. */
function companyDatabases() {
  return {
    connector: 'rdb',
    connected: true,
    config: {
      databases: DATABASES.map((database, index) => ({ id: DATABASE_IDS[index], ...database.config })),
    },
  };
}

export const SCALE_CONNECTIONS = [
  companyDatabases(),
  { connector: 'http', connected: true, config: { endpoints: API_ENDPOINTS } },
  { connector: 'gmail', connected: true, config: {} },
  { connector: 'slack', connected: true, config: {} },
  {
    connector: 'local_folder',
    connected: true,
    config: {
      folders: [
        { id: 'f-sales', path: 'D:/공유/영업자료', label: '영업자료', addedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'f-hr', path: 'D:/공유/인사규정', label: '인사규정', addedAt: '2026-01-01T00:00:00.000Z' },
        { id: 'f-reports', path: 'D:/공유/월간보고', label: '월간보고', addedAt: '2026-01-01T00:00:00.000Z' },
      ],
    },
  },
];

export const SCALE_HTTP_ENDPOINTS = API_ENDPOINTS.map((entry) => ({ id: entry.id, label: entry.label, usable: true }));
export const SCALE_CONNECTED = ['rdb', 'http', 'gmail', 'slack', 'local_folder'];
