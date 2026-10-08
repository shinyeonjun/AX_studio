import type { TableArtifact } from '../../../../contracts/artifacts/table.js';
import type { JevChatRouterResult } from './jev-router-contract.js';

/**
 * Jev routing evaluation set: what people ask, and where the request must go. Each case names
 * only what matters for that request, so a case stays valid when unrelated wording changes.
 * Add a case for every routing bug found in dogfood (the pesticide paradox: the set grows with
 * the bugs it has already caught).
 */
export interface JevRoutingCase {
  id: string;
  message: string;
  /** A table the previous answer showed, for follow-up questions. */
  previous?: 'orders';
  expect: {
    /** Any of these result kinds passes (Jev may reasonably ask or act). */
    kind: ReadonlyArray<JevChatRouterResult['kind']>;
    route?: readonly string[];
    /** The read that must run; several when either is a right answer. */
    capabilityId?: string | readonly string[];
    /** Subset of the chosen read's params (e.g. the base table); an array lists acceptable values. */
    params?: Record<string, unknown>;
    join?: readonly string[];
    tableTransform?: readonly string[];
    /** The "어디에서 찾을까요?" source chooser. */
    sourceChooser?: boolean;
  };
}

export const JEV_ROUTING_CASES: readonly JevRoutingCase[] = [
  { id: 'greeting', message: '안녕', expect: { kind: ['reply'] } },
  { id: 'capabilities', message: '너는 뭘 할 수 있어?', expect: { kind: ['reply'] } },
  { id: 'db-orders', message: '쇼핑몰 DB에서 주문 목록 보여줘', expect: { kind: ['command'], capabilityId: 'rdb.query.read', params: { table: 'orders' } } },
  { id: 'db-region-sum', message: '지역별 매출 합계 알려줘', expect: { kind: ['command'], capabilityId: 'rdb.query.read', params: { table: 'orders' }, join: ['customers'], tableTransform: ['calculate'] } },
  { id: 'db-category-sum', message: '상품 카테고리별 매출 합계 보여줘', expect: { kind: ['command'], capabilityId: 'rdb.query.read', params: { table: 'orders' }, join: ['products'], tableTransform: ['calculate'] } },
  { id: 'db-multi-filter', message: '완료된 주문 중에 5만원 넘는 것만 보여줘', expect: { kind: ['command'], capabilityId: 'rdb.query.read', params: { table: 'orders' }, tableTransform: ['filter', 'filter_sort'] } },
  { id: 'db-top-amount', message: '주문 금액이 가장 큰 5건 보여줘', expect: { kind: ['command'], capabilityId: 'rdb.query.read', params: { table: 'orders' }, tableTransform: ['sort', 'filter_sort'] } },
  { id: 'api-products', message: 'DummyJSON에서 상품 5개 보여줘', expect: { kind: ['command'], capabilityId: 'http.request', params: { path: 'products' } } },
  { id: 'api-top-rated', message: 'DummyJSON 상품 중 평점 높은 순으로 10개 보여줘', expect: { kind: ['command'], capabilityId: 'http.request', params: { path: 'products' }, tableTransform: ['sort', 'filter_sort'] } },
  { id: 'two-sources', message: '화장품 상품 찾아줘', expect: { kind: ['clarify'], sourceChooser: true } },
  { id: 'gmail-recent', message: '최근 메일 5개 제목만 보여줘', expect: { kind: ['command'], capabilityId: 'gmail.messages.search' } },
  { id: 'slack-channels', message: '슬랙 채널 목록 보여줘', expect: { kind: ['command'], capabilityId: 'slack.channels.list' } },
  { id: 'connections', message: '연결된 데이터 뭐 있어?', expect: { kind: ['command'], route: ['connection_list', 'source_list', 'resource_list'] } },
  { id: 'works', message: '내 업무 목록 보여줘', expect: { kind: ['command'], route: ['workflow_list'] } },
  { id: 'recurring-report', message: '매주 월요일 9시에 지역별 매출 합계를 슬랙 #ax테스트로 보내줘', expect: { kind: ['command', 'clarify'], route: ['workflow_create', 'job_propose'] } },
  { id: 'mail-trigger', message: 'Gmail로 새 메일이 오면 요약해서 슬랙으로 알려주는 업무 만들어줘', expect: { kind: ['command', 'clarify'], route: ['workflow_create', 'job_propose'] } },
  { id: 'remember', message: '앞으로 이 대화에서는 금액을 만원 단위로 말해줘', expect: { kind: ['command', 'clarify'], route: ['context_remember'] } },
  { id: 'follow-sort', previous: 'orders', message: '방금 결과를 금액 높은 순으로 정렬해줘', expect: { kind: ['previous_result'] } },
  { id: 'follow-filter', previous: 'orders', message: '거기서 서울만 남겨줘', expect: { kind: ['previous_result'] } },
];

/** The table a follow-up case refers to. */
export function previousOrdersTable(): TableArtifact {
  const rows = [
    { id: 1, region: '서울', amount: 52000, status: '완료' },
    { id: 2, region: '부산', amount: 31000, status: '완료' },
    { id: 3, region: '서울', amount: 18000, status: '취소' },
  ];
  return {
    id: 'previous-orders', kind: 'table', sourceId: 'chat:read-result', createdAt: '2026-10-07T00:00:00.000Z',
    columns: [
      { name: 'id', type: 'integer', nullable: false, inferred: false },
      { name: 'region', type: 'string', nullable: false, inferred: false },
      { name: 'amount', type: 'number', nullable: false, inferred: false },
      { name: 'status', type: 'string', nullable: false, inferred: false },
    ],
    rows: rows.map((values, index) => ({ index, values })),
    truncated: false,
    completeness: { status: 'complete', hasMore: false },
  } as unknown as TableArtifact;
}

/** Why a routing result misses its case, or undefined when it passes. */
export function routingMiss(testCase: JevRoutingCase, result: JevChatRouterResult): string | undefined {
  const { expect } = testCase;
  if (!expect.kind.includes(result.kind)) return `kind ${result.kind}${result.kind === 'fallback' ? ` (${result.reason})` : ''}`;
  const route = 'route' in result ? result.route : undefined;
  if (expect.route && !expect.route.includes(String(route))) return `route ${String(route)}`;
  if (expect.sourceChooser && result.presentation?.title !== '어디에서 찾을까요?') return 'no source chooser';
  if (result.kind !== 'command') return undefined;
  const command = result.command;
  const id = command.name === 'capability.invoke' ? command.args.id : command.name;
  const capabilityIds = typeof expect.capabilityId === 'string' ? [expect.capabilityId] : expect.capabilityId;
  if (capabilityIds && !capabilityIds.includes(String(id))) return `capability ${String(id)}`;
  const params = command.name === 'capability.invoke' ? command.args.params as Record<string, unknown> | undefined : undefined;
  for (const [key, value] of Object.entries(expect.params ?? {})) {
    const actual = params?.[key];
    const accepted = Array.isArray(value) ? value : [value];
    const shown = key === 'path' && typeof actual === 'string' ? actual.split('?')[0] : actual;
    if (!accepted.includes(shown)) return `${key} ${JSON.stringify(actual)}`;
  }
  if (expect.join) {
    const joined = Array.isArray(params?.join) ? (params.join as Array<{ table?: unknown }>).map((entry) => entry.table) : [];
    const missing = expect.join.filter((table) => !joined.includes(table));
    if (missing.length) return `join missing ${missing.join(', ')}`;
  }
  if (expect.tableTransform && !expect.tableTransform.includes(String(result.tableTransform))) return `tableTransform ${String(result.tableTransform)}`;
  return undefined;
}

const read = (connectionId: string, table: string | string[], extra: Partial<JevRoutingCase['expect']> = {}): JevRoutingCase['expect'] =>
  ({ kind: ['command'], capabilityId: 'rdb.query.read', params: { connectionId, table }, ...extra });
const api = (connectionId: string, path: string | string[], extra: Partial<JevRoutingCase['expect']> = {}): JevRoutingCase['expect'] =>
  ({ kind: ['command'], capabilityId: 'http.request', params: { connectionId, path }, ...extra });

/**
 * The same kind of requests in a company-sized workspace (jev-routing-eval.scale-fixture.ts):
 * eight databases (50+ tables, "orders" in two of them), 25 APIs, Gmail, Slack and folders, with
 * names that collide (orders, users, issues). Where two sources are equally right, either passes;
 * where nothing in the request tells them apart, the person must be asked.
 */
export const JEV_SCALE_ROUTING_CASES: readonly JevRoutingCase[] = [
  { id: 'scale-greeting', message: '안녕하세요', expect: { kind: ['reply'] } },
  { id: 'scale-leave-balance', message: '직원별 남은 연차 일수 보여줘', expect: read('hr', 'leave_balances') },
  { id: 'scale-delay-reasons', message: '배송 지연 사유별로 몇 건인지 알려줘', expect: read('logistics', 'delivery_delays', { tableTransform: ['calculate'] }) },
  { id: 'scale-shop-paid', message: '쇼핑몰 주문 중에 결제 완료된 것만 보여줘', expect: read('shop', 'orders', { tableTransform: ['filter', 'filter_sort'] }) },
  { id: 'scale-logistics-orders', message: '물류 쪽 주문 목록 보여줘', expect: read('logistics', 'orders') },
  { id: 'scale-ambiguous-orders', message: '주문 목록 보여줘', expect: { kind: ['clarify'], sourceChooser: true } },
  { id: 'scale-crm-deals', message: 'CRM에서 진행 중인 거래 금액 합계 알려줘', expect: read('crm', 'deals', { tableTransform: ['calculate'] }) },
  { id: 'scale-urgent-tickets', message: '고객지원 티켓 중에 우선순위 높은 것만 보여줘', expect: read('support', 'tickets', { tableTransform: ['filter', 'filter_sort'] }) },
  { id: 'scale-payroll', message: '이번 달 부서별 급여 합계', expect: read('hr', ['payroll', 'employees'], { tableTransform: ['calculate'] }) },
  { id: 'scale-fx', message: '환율 API에서 달러 환율 보여줘', expect: api('fx-api', ['rates', 'history']) },
  { id: 'scale-weather', message: '오늘 날씨 어때?', expect: api('weather-api', ['current', 'forecast']) },
  { id: 'scale-github-issues', message: 'GitHub 이슈 목록 보여줘', expect: api('github-api', 'issues') },
  { id: 'scale-jira-issues', message: 'Jira 이슈 목록 보여줘', expect: api('jira-api', 'issues') },
  { id: 'scale-dummy-users', message: 'DummyJSON 사용자 목록 보여줘', expect: api('dummyjson', 'users') },
  { id: 'scale-placeholder-users', message: 'JSONPlaceholder에서 사용자 목록 가져와', expect: api('jsonplaceholder', 'users') },
  { id: 'scale-low-stock', message: '재고 부족한 상품 알려줘', expect: { kind: ['command', 'clarify'], capabilityId: ['rdb.query.read', 'http.request'] } },
  { id: 'scale-mail', message: '최근 메일 5개 제목만 보여줘', expect: { kind: ['command'], capabilityId: 'gmail.messages.search' } },
  { id: 'scale-slack', message: '슬랙 채널 목록 보여줘', expect: { kind: ['command'], capabilityId: 'slack.channels.list' } },
  { id: 'scale-folder', message: '월간보고 폴더에 어떤 파일 있어?', expect: { kind: ['command'], capabilityId: 'local_folder.list' } },
  { id: 'scale-works', message: '내 업무 목록 보여줘', expect: { kind: ['command'], route: ['workflow_list'] } },
  { id: 'scale-erp-vendors', message: 'ERP에서 매입처 목록 보여줘', expect: read('erp', 'tb_vndr_mst') },
  { id: 'scale-erp-tax-invoices', message: '세금계산서 발행 내역 보여줘', expect: read('erp', 'tb_tax_inv') },
  { id: 'scale-erp-warehouse', message: '창고 입출고 이력 보여줘', expect: { kind: ['command', 'clarify'], capabilityId: 'rdb.query.read', params: { connectionId: ['erp', 'inventory'] } } },
  { id: 'scale-recurring', message: '매주 월요일 9시에 지역별 매출 합계를 슬랙으로 보내줘', expect: { kind: ['command', 'clarify'], route: ['workflow_create', 'job_propose'] } },
];
