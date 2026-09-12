const field = (path) => ({ kind: 'field', path });

const currency = { style: 'currency', currency: 'KRW', decimals: 0 };
const integer = { style: 'integer' };
const percent = { style: 'percent', decimals: 2 };

const tableColumns = [
  { id: 'customer_id', value: { kind: 'group_key', keyId: 'customer_id' }, format: { style: 'text' } },
  { id: 'customer_name', value: { kind: 'group_key', keyId: 'customer_name' }, format: { style: 'text' } },
  { id: 'region', value: { kind: 'group_key', keyId: 'region' }, format: { style: 'text' } },
  { id: 'revenue', value: { kind: 'aggregate', expression: { kind: 'sum', value: field('orders.amount') } }, format: currency },
  { id: 'orders', value: { kind: 'aggregate', expression: { kind: 'count' } }, format: integer },
  {
    id: 'attainment',
    value: {
      kind: 'aggregate',
      expression: {
        kind: 'arithmetic',
        operation: 'divide',
        left: { kind: 'sum', value: field('orders.amount') },
        right: { kind: 'first', value: field('customers.target'), requireConsistent: true },
      },
    },
    format: percent,
  },
];

function reportPlan() {
  return {
    schemaVersion: 1,
    baseSource: 'orders',
    joins: [{
      source: 'customers',
      left: 'orders.customer_id',
      right: 'customer_id',
      type: 'inner',
      cardinality: 'one',
    }],
    scalars: [
      { id: 'period', expression: field('meta.periodLabel'), format: { style: 'text' } },
      { id: 'revenue', expression: { kind: 'sum', value: field('orders.amount') }, format: currency },
      { id: 'orders', expression: { kind: 'count' }, format: integer },
      { id: 'customers', expression: { kind: 'count_distinct', value: field('orders.customer_id') }, format: integer },
      {
        id: 'attainment',
        expression: {
          kind: 'arithmetic',
          operation: 'divide',
          left: { kind: 'sum', value: field('orders.amount') },
          right: { kind: 'sum_distinct', value: field('customers.target'), distinctBy: field('orders.customer_id') },
        },
        format: percent,
      },
      { id: 'status', expression: { kind: 'literal', value: 'PASS' }, format: { style: 'text' } },
    ],
    tables: [{
      kind: 'aggregate',
      id: 'customer_performance',
      groupBy: [
        { id: 'customer_id', value: field('orders.customer_id') },
        { id: 'customer_name', value: field('customers.name') },
        { id: 'region', value: field('customers.region') },
      ],
      columns: tableColumns,
      sort: [{ columnId: 'revenue', direction: 'desc' }],
    }],
    texts: [],
  };
}

function layoutFor(pair) {
  const scalarIds = ['period', 'revenue', 'orders', 'customers', 'attainment', 'status'];
  if (pair.scalarSlots.length !== scalarIds.length) {
    throw new Error('benchmark_pair_scalar_contract:' + pair.scalarSlots.length);
  }
  if (pair.tableGroups.length !== 1) {
    throw new Error('benchmark_pair_table_contract:' + pair.tableGroups.length);
  }
  const group = pair.tableGroups[0];
  if (group.columnCount !== tableColumns.length) {
    throw new Error('benchmark_pair_column_contract:' + group.columnCount);
  }
  return {
    schemaVersion: 1,
    outputFileName: 'monthly_customer_report_{{meta.periodYearMonth}}.pdf',
    scalarBindings: pair.scalarSlots.map((slot, index) => ({
      slotId: slot.id,
      value: { kind: 'scalar', id: scalarIds[index] },
    })),
    tableBindings: [{
      groupId: group.id,
      tableId: 'customer_performance',
      columns: tableColumns.map((column, columnIndex) => ({
        columnIndex,
        columnId: column.id,
      })),
    }],
  };
}

export function createBenchmarkPlanner(benchmarkCase) {
  return {
    forExecution() {
      return this;
    },
    async inferSourceRequirements() {
      return [
        {
          id: 'orders-api',
          connector: 'http',
          description: '기간별 주문 원천',
          reason: '보고서 매출과 주문 KPI',
        },
        {
          id: 'customer-db',
          connector: 'rdb',
          description: '고객 계약 목표와 지역',
          reason: '고객별 목표 달성률과 지역 분류',
        },
      ];
    },
    async inferCapturePlan() {
      return {
        schemaVersion: 1,
        examplePeriod: benchmarkCase.examplePeriod,
        targetPeriod: benchmarkCase.targetPeriod,
        capturePlan: {
          schemaVersion: 1,
          http: [{
            alias: 'orders',
            connectionId: 'orders-api',
            path: '/api/v1/orders',
            rowsPath: benchmarkCase.httpRowsPath ?? 'items',
            dateQuery: { fromParam: 'from', toParam: 'to' },
            pagination: {
              pageParam: 'page',
              sizeParam: 'size',
              pageSize: benchmarkCase.httpPageSize ?? 2,
              totalPagesPath: benchmarkCase.httpTotalPagesPath ?? 'totalPages',
              currentPagePath: benchmarkCase.httpCurrentPagePath ?? 'page',
              maxPages: 20,
            },
          }],
          rdb: [{ alias: 'customers', table: 'public.customers' }],
        },
        requirementBindings: [
          { requirementId: 'orders-api', aliases: ['orders'] },
          { requirementId: 'customer-db', aliases: ['customers'] },
        ],
      };
    },
    async refineCapturePlan({ provisional }) {
      return provisional;
    },
    async inferReportPlan({ pair }) {
      return { schemaVersion: 1, reportPlan: reportPlan(), layout: layoutFor(pair) };
    },
  };
}
