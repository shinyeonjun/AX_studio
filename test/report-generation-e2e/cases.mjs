/**
 * Literal benchmark cases. These values are the independent gold boundary:
 * the runner must never derive them by calling executeReportPlan.
 *
 * The goals are intentionally written like real user requests. The planner is
 * deterministic in this benchmark, so the strings exercise the service input
 * boundary without pretending to measure LLM semantic discovery.
 */

const customers = [
  { customer_id: 'C001', name: 'Kim Hana', region: 'Seoul', target: 1000 },
  { customer_id: 'C002', name: 'Lee Seojun', region: 'Busan', target: 2000 },
  { customer_id: 'C003', name: 'Park Jimin', region: 'Gyeonggi', target: 1500 },
  { customer_id: 'C004', name: 'Choi Yujin', region: 'Jeju', target: 500 },
];

const completeExampleOrders = [
  { order_id: 'A-001', customer_id: 'C001', amount: 400, status: 'PAID' },
  { order_id: 'A-002', customer_id: 'C001', amount: 200, status: 'PAID' },
  { order_id: 'A-003', customer_id: 'C002', amount: 800, status: 'PAID' },
  { order_id: 'A-004', customer_id: 'C003', amount: 750, status: 'PAID' },
  { order_id: 'A-005', customer_id: 'C004', amount: 500, status: 'PAID' },
];

const completeTargetOrders = [
  { order_id: 'B-001', customer_id: 'C001', amount: 500, status: 'PAID' },
  { order_id: 'B-002', customer_id: 'C001', amount: 400, status: 'PAID' },
  { order_id: 'B-003', customer_id: 'C002', amount: 1200, status: 'PAID' },
  { order_id: 'B-004', customer_id: 'C003', amount: 600, status: 'PAID' },
  { order_id: 'B-005', customer_id: 'C004', amount: 350, status: 'PAID' },
];

const completeExampleRows = [
  { id: 'C002', name: 'Lee Seojun', region: 'Busan', revenue: 'KRW 800', orders: '1', attainment: '40.00%' },
  { id: 'C003', name: 'Park Jimin', region: 'Gyeonggi', revenue: 'KRW 750', orders: '1', attainment: '50.00%' },
  { id: 'C001', name: 'Kim Hana', region: 'Seoul', revenue: 'KRW 600', orders: '2', attainment: '60.00%' },
  { id: 'C004', name: 'Choi Yujin', region: 'Jeju', revenue: 'KRW 500', orders: '1', attainment: '100.00%' },
];

const completeTargetRows = [
  { id: 'C002', name: 'Lee Seojun', region: 'Busan', revenue: 'KRW 1,200', orders: '1', attainment: '60.00%' },
  { id: 'C001', name: 'Kim Hana', region: 'Seoul', revenue: 'KRW 900', orders: '2', attainment: '90.00%' },
  { id: 'C003', name: 'Park Jimin', region: 'Gyeonggi', revenue: 'KRW 600', orders: '1', attainment: '40.00%' },
  { id: 'C004', name: 'Choi Yujin', region: 'Jeju', revenue: 'KRW 350', orders: '1', attainment: '70.00%' },
];

const completeExampleExpected = {
  scalars: ['2026-08', 'KRW 2,650', '5', '4', '53.00%', 'PASS'],
  rows: completeExampleRows,
};
const completeTargetExpected = {
  scalars: ['2026-09', 'KRW 3,050', '5', '4', '61.00%', 'PASS'],
  rows: completeTargetRows,
};

const dynamicExampleOrders = completeExampleOrders.slice(0, 3);
const dynamicTargetOrders = completeTargetOrders.slice(0, 4);
const dynamicExampleRows = [
  { id: 'C002', name: 'Lee Seojun', region: 'Busan', revenue: 'KRW 800', orders: '1', attainment: '40.00%' },
  { id: 'C001', name: 'Kim Hana', region: 'Seoul', revenue: 'KRW 600', orders: '2', attainment: '60.00%' },
];
const dynamicTargetRows = [
  { id: 'C002', name: 'Lee Seojun', region: 'Busan', revenue: 'KRW 1,200', orders: '1', attainment: '60.00%' },
  { id: 'C001', name: 'Kim Hana', region: 'Seoul', revenue: 'KRW 900', orders: '2', attainment: '90.00%' },
  { id: 'C003', name: 'Park Jimin', region: 'Gyeonggi', revenue: 'KRW 600', orders: '1', attainment: '40.00%' },
];

const periods = {
  example: { start: '2026-08-01', endInclusive: '2026-08-31', label: '2026-08' },
  target: { start: '2026-09-01', endInclusive: '2026-09-30', label: '2026-09' },
};

function baseCase(overrides = {}) {
  const requestedGoal = overrides.goal
    ?? '지난달 예시 보고서와 연결된 주문 API·고객 계약 DB를 확인해서 이번 달 고객 매출 보고서를 같은 형식으로 만들어줘.';
  return {
    templateRows: 4,
    footer: 'safe',
    examplePeriod: periods.example,
    targetPeriod: periods.target,
    customers,
    exampleOrders: completeExampleOrders,
    targetOrders: completeTargetOrders,
    exampleExpected: completeExampleExpected,
    targetExpected: completeTargetExpected,
    expectedOutcome: 'success',
    ...overrides,
    goal: requestedGoal.includes('/api/v1/orders')
      ? requestedGoal
      : `${requestedGoal} 주문 API 경로는 /api/v1/orders야.`,
  };
}

export const CASES = Object.freeze([
  baseCase({
    id: 'complete-api-db-report',
    category: 'positive-baseline',
    description: 'Paginated local REST orders joined with a paginated customer database.',
  }),
  baseCase({
    id: 'dynamic-row-extension',
    category: 'positive-layout-extension',
    description: 'Target data has one more customer row than the example template.',
    templateRows: 2,
    exampleOrders: dynamicExampleOrders,
    targetOrders: dynamicTargetOrders,
    exampleExpected: {
      scalars: ['2026-08', 'KRW 1,400', '3', '2', '46.67%', 'PASS'],
      rows: dynamicExampleRows,
    },
    targetExpected: {
      scalars: ['2026-09', 'KRW 2,700', '4', '3', '60.00%', 'PASS'],
      rows: dynamicTargetRows,
    },
    goal: '예시 양식의 모양은 유지하되 이번 달 고객이 늘어도 표에서 한 명도 빠뜨리지 말고 작성해줘.',
  }),
  baseCase({
    id: 'deep-pagination-replay',
    category: 'positive-pagination',
    description: 'The same report remains complete when both sources require one-row pages.',
    httpPageSize: 1,
    rdbPageSize: 1,
    goal: 'API와 계약 DB가 여러 페이지로 나와도 전부 읽고 합산해서 누락 없는 월간 보고서를 만들어줘.',
  }),
  baseCase({
    id: 'nested-http-envelope',
    category: 'positive-api-shape',
    description: 'The REST response stores rows and pagination metadata below nested keys.',
    httpEnvelope: 'nested',
    httpRowsPath: 'data.items',
    httpTotalPagesPath: 'meta.totalPages',
    httpCurrentPagePath: 'meta.page',
    goal: '주문 API 응답이 data.items 안에 있고 페이지 정보도 중첩되어 있어. 구조를 확인해서 같은 양식으로 보고서 작성해줘.',
  }),
  baseCase({
    id: 'natural-language-goal',
    category: 'positive-natural-language',
    description: 'A colloquial Korean request is accepted while the deterministic source plan stays bounded.',
    goal: '자료에 있는 지난달 보고서 양식을 그대로 참고해서 이번 달 주문 API와 계약 DB를 알아서 확인하고, 숫자와 고객별 표를 빠짐없이 채워줘.',
  }),
  baseCase({
    id: 'source-order-invariance',
    category: 'positive-order-invariance',
    description: 'Reordered source pages produce the same sorted customer output and KPI values.',
    exampleOrders: [...completeExampleOrders].reverse(),
    targetOrders: [completeTargetOrders[2], completeTargetOrders[4], completeTargetOrders[0], completeTargetOrders[3], completeTargetOrders[1]],
    goal: '원천 API의 행 순서는 믿지 말고 전체를 읽은 뒤 고객별 매출이 큰 순서로 예시 형식에 맞춰줘.',
  }),
  baseCase({
    id: 'safe-failure-layout-capacity',
    category: 'safe-failure-layout',
    description: 'A target table exceeds the verified page gap and must fail closed.',
    templateRows: 2,
    footer: 'tight',
    exampleOrders: dynamicExampleOrders,
    expectedOutcome: 'failure',
    expectedErrorCode: 'report_table_capacity_exceeded',
    exampleExpected: {
      scalars: ['2026-08', 'KRW 1,400', '3', '2', '46.67%', 'PASS'],
      rows: dynamicExampleRows,
    },
    goal: '표 공간을 넘으면 억지로 잘라서 성공 처리하지 말고 사용자에게 확인을 요청해줘.',
  }),
  baseCase({
    id: 'safe-failure-empty-target',
    category: 'safe-failure-empty-period',
    description: 'An empty target period does not produce a misleading zero-denominator PDF.',
    targetOrders: [],
    expectedOutcome: 'failure',
    expectedErrorCode: 'report_division_by_zero',
    targetExpected: { scalars: [], rows: [] },
    goal: '이번 달 주문이 없으면 임의의 숫자를 채우지 말고 보고서를 만들 수 없는 이유를 알려줘.',
  }),
  baseCase({
    id: 'safe-failure-http-page-mismatch',
    category: 'safe-failure-pagination-contract',
    description: 'A provider page that reports the wrong page number fails closed.',
    httpFault: { kind: 'page-mismatch', page: 2 },
    expectedOutcome: 'failure',
    expectedErrorCode: 'report_http_page_mismatch',
    goal: '페이지 번호가 이상하면 일부 데이터만으로 보고서를 완성하지 말고 조회 오류로 멈춰줘.',
  }),
  baseCase({
    id: 'safe-failure-http-no-progress',
    category: 'safe-failure-pagination-contract',
    description: 'Repeated REST page content is detected instead of being counted twice.',
    httpFault: { kind: 'repeat-page', page: 2 },
    expectedOutcome: 'failure',
    expectedErrorCode: 'report_http_pagination_no_progress',
    goal: 'API 페이지가 반복되면 같은 주문을 중복 집계하지 말고 안전하게 중단해줘.',
  }),
  baseCase({
    id: 'safe-failure-http-service-unavailable',
    category: 'safe-failure-source-outage',
    description: 'An unavailable orders API cannot be replaced with a guessed or partial source.',
    httpFault: { kind: 'status', status: 503 },
    expectedOutcome: 'failure',
    expectedErrorCode: 'report_http_probe_status',
    goal: '주문 API가 잠시 장애면 다른 자료를 추측해서 채우지 말고 재시도 가능한 실패로 남겨줘.',
  }),
  baseCase({
    id: 'safe-failure-http-invalid-json',
    category: 'safe-failure-source-shape',
    description: 'A successful HTTP status with a non-JSON body is rejected.',
    httpFault: { kind: 'invalid-json' },
    expectedOutcome: 'failure',
    expectedErrorCode: 'report_http_probe_not_json',
    goal: '응답 형식이 JSON이 아니면 내용을 추측하지 말고 원천 자료 오류로 알려줘.',
  }),
  baseCase({
    id: 'safe-failure-rdb-incomplete',
    category: 'safe-failure-source-completeness',
    description: 'An RDB page that claims incomplete data without a next page fails closed.',
    rdbFault: { kind: 'incomplete' },
    expectedOutcome: 'failure',
    expectedErrorCode: 'report_rdb_response_incomplete',
    goal: '계약 DB 조회가 덜 끝났다면 현재 일부 고객만으로 보고서를 만들지 말아줘.',
  }),
  baseCase({
    id: 'safe-failure-rdb-no-progress',
    category: 'safe-failure-source-completeness',
    description: 'Repeated RDB page content is detected before duplicate aggregation.',
    rdbFault: { kind: 'repeat-page' },
    expectedOutcome: 'failure',
    expectedErrorCode: 'report_rdb_pagination_no_progress',
    goal: 'DB 페이지가 반복되면 고객을 중복 집계하지 말고 원천 조회 오류로 멈춰줘.',
  }),
  baseCase({
    id: 'safe-failure-join-cardinality',
    category: 'safe-failure-data-integrity',
    description: 'Duplicate customer identity rows do not silently choose one contract target.',
    rdbFault: { kind: 'duplicate-customer', customer: customers[0] },
    expectedOutcome: 'failure',
    expectedErrorCode: 'report_example_replay_failed',
    goal: '고객 계약 DB에 같은 고객이 여러 번 나오면 임의의 목표를 고르지 말고 확인을 요청해줘.',
  }),
]);

export function caseById(id) {
  return CASES.find((item) => item.id === id);
}
