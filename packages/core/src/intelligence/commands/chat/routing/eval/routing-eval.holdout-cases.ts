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
