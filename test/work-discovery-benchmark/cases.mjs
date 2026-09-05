const OBSERVATION_PATH = 'field.metric';

function hashSeed(seed, label) {
  let hash = 2166136261;
  for (const character of `${seed}:${label}`) {
    hash ^= character.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return Math.abs(hash >>> 0);
}

function variation(seed, label, span) {
  return hashSeed(seed, label) % span;
}

function canonicalize(value) {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, entry]) => [key, canonicalize(entry)]),
    );
  }
  return value;
}

export function expressionSignature(expression) {
  return JSON.stringify(canonicalize(expression));
}

function inferType(values) {
  const nonNull = values.filter((value) => value !== null && value !== undefined);
  if (nonNull.length === 0) return 'unknown';
  if (nonNull.every((value) => typeof value === 'number' && Number.isInteger(value))) return 'integer';
  if (nonNull.every((value) => typeof value === 'number')) return 'number';
  if (nonNull.every((value) => typeof value === 'boolean')) return 'boolean';
  return 'string';
}

function tableArtifact({ id, name, headers, rows, sourceTable, truncated = false }) {
  return {
    id,
    kind: 'table',
    name,
    columns: headers.map((header) => ({
      name: header,
      type: inferType(rows.map((row) => row[header])),
      nullable: true,
      inferred: true,
    })),
    rows: rows.map((values, index) => ({ index, values })),
    truncated,
    source: {
      database: 'ax_benchmark',
      schema: 'public',
      table: sourceTable,
    },
  };
}

function sourceDescriptor(id, label) {
  return {
    id,
    connector: 'benchmark_fixture',
    label,
    kind: 'table',
    relevance: 1,
    metadata: { environment: 'local_test_lab' },
  };
}

function aggregate(sourceId, fn, column) {
  return {
    op: 'aggregate',
    input: { op: 'source', sourceId },
    fn,
    ...(column ? { column } : {}),
  };
}

function ratio(sourceId) {
  return {
    op: 'ratio',
    numerator: aggregate(sourceId, 'sum', 'actual'),
    denominator: aggregate(sourceId, 'sum', 'target'),
    multiplyBy: 100,
  };
}

function observation(exampleId, caseId, value, display) {
  return {
    id: `observation_${caseId}_${exampleId}`,
    exampleId,
    path: OBSERVATION_PATH,
    label: '결과 숫자',
    value: { kind: 'number', value, display: display ?? String(value) },
    role: 'dynamic_value',
    required: true,
  };
}

function createCase({
  id,
  domain,
  title,
  goal,
  sources,
  training,
  holdout,
  expectedOutcome,
  expectedSources,
  expectedExpressions,
  holdoutSourceId,
}) {
  const toExample = (entry, index, phase) => {
    const exampleId = `${phase}_${String(index + 1).padStart(2, '0')}`;
    return {
      id: exampleId,
      phase,
      observations: [observation(exampleId, id, entry.value, entry.display)],
      snapshots: entry.snapshots,
    };
  };

  return {
    schemaVersion: 1,
    id,
    domain,
    title,
    goal,
    observationPath: OBSERVATION_PATH,
    sources,
    examples: training.map((entry, index) => toExample(entry, index, 'examples')),
    holdout: holdout.map((entry, index) => toExample(entry, index, 'holdout')),
    expected: {
      outcome: expectedOutcome,
      sourceIds: expectedSources,
      expressionSignatures: expectedExpressions.map(expressionSignature),
      holdoutSourceId,
    },
  };
}

function orderRows(seed, caseId, period, count, base) {
  return Array.from({ length: count }, (_, index) => ({
    order_id: `${caseId}-${period + 1}-${index + 1}-${variation(seed, `${caseId}:${period}:${index}`, 900)}`,
    amount: base + index * 137 + variation(seed, `${caseId}:amount:${period}:${index}`, 97),
    status: index % 3 === 0 ? 'paid' : 'pending',
  }));
}

function makeOrderTable(seed, caseId, period, count, base, tableName = 'orders') {
  return tableArtifact({
    id: `snapshot_${caseId}_${period}_${tableName}`,
    name: tableName,
    headers: ['order_id', 'amount', 'status'],
    rows: orderRows(seed, caseId, period, count, base),
    sourceTable: tableName,
  });
}

function numericValue(table, column) {
  return table.rows
    .map((row) => row.values[column])
    .filter((value) => typeof value === 'number')
    .reduce((sum, value) => sum + value, 0);
}

function averageValue(table, column) {
  const values = table.rows
    .map((row) => row.values[column])
    .filter((value) => typeof value === 'number');
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function entriesFromTables(tables, sourceId, value) {
  return { snapshots: { [sourceId]: tables }, value };
}

function buildSalesTotal(seed) {
  const sourceId = 'rdb:orders';
  const sources = [sourceDescriptor(sourceId, '주문 원장')];
  const training = [];
  const holdout = [];
  for (let period = 0; period < 3; period += 1) {
    const table = makeOrderTable(seed, 'B01', period, 4, 1200 + period * 180);
    training.push({ snapshots: { [sourceId]: table }, value: numericValue(table, 'amount') });
  }
  for (let period = 3; period < 5; period += 1) {
    const table = makeOrderTable(seed, 'B01', period, 5, 1400 + period * 180);
    holdout.push({ snapshots: { [sourceId]: table }, value: numericValue(table, 'amount') });
  }
  return createCase({
    id: 'B01',
    domain: 'sales',
    title: '월간 총매출',
    goal: '과거 월간 매출 결과를 재현하는 source와 합계를 찾아라.',
    sources,
    training,
    holdout,
    expectedOutcome: 'publish',
    expectedSources: [sourceId],
    expectedExpressions: [aggregate(sourceId, 'sum', 'amount')],
    holdoutSourceId: sourceId,
  });
}

function buildOrderCount(seed) {
  const sourceId = 'rdb:orders';
  const sources = [sourceDescriptor(sourceId, '주문 원장')];
  const training = [];
  const holdout = [];
  for (let period = 0; period < 3; period += 1) {
    const table = makeOrderTable(seed, 'B02', period, 3 + period, 1000 + period * 110);
    training.push({ snapshots: { [sourceId]: table }, value: table.rows.length });
  }
  for (let period = 3; period < 5; period += 1) {
    const table = makeOrderTable(seed, 'B02', period, 4 + (period % 2), 1300 + period * 110);
    holdout.push({ snapshots: { [sourceId]: table }, value: table.rows.length });
  }
  return createCase({
    id: 'B02',
    domain: 'sales',
    title: '주문 건수',
    goal: '기간별 주문 건수를 찾아라.',
    sources,
    training,
    holdout,
    expectedOutcome: 'publish',
    expectedSources: [sourceId],
    expectedExpressions: [aggregate(sourceId, 'count')],
    holdoutSourceId: sourceId,
  });
}

function buildAverageOrder(seed) {
  const sourceId = 'rdb:orders';
  const sources = [sourceDescriptor(sourceId, '주문 원장')];
  const training = [];
  const holdout = [];
  for (let period = 0; period < 3; period += 1) {
    const table = makeOrderTable(seed, 'B03', period, 3 + (period % 2), 1700 + period * 130);
    training.push({ snapshots: { [sourceId]: table }, value: averageValue(table, 'amount') });
  }
  for (let period = 3; period < 5; period += 1) {
    const table = makeOrderTable(seed, 'B03', period, 4 + (period % 2), 1900 + period * 130);
    holdout.push({ snapshots: { [sourceId]: table }, value: averageValue(table, 'amount') });
  }
  return createCase({
    id: 'B03',
    domain: 'sales',
    title: '평균 주문액',
    goal: '기간별 평균 주문액을 찾아라.',
    sources,
    training,
    holdout,
    expectedOutcome: 'publish',
    expectedSources: [sourceId],
    expectedExpressions: [aggregate(sourceId, 'avg', 'amount')],
    holdoutSourceId: sourceId,
  });
}

function buildTargetAttainment(seed) {
  const sourceId = 'rdb:targets';
  const sources = [sourceDescriptor(sourceId, '매출 목표표')];
  const makeTable = (period) => {
    const rows = Array.from({ length: 3 }, (_, index) => ({
      team: `team-${period + 1}-${index + 1}`,
      actual: 800 + period * 100 + index * 73 + variation(seed, `B04:actual:${period}:${index}`, 40),
      target: 1000 + period * 120 + index * 91 + variation(seed, `B04:target:${period}:${index}`, 45),
    }));
    return tableArtifact({
      id: `snapshot_B04_${period}`,
      name: 'targets',
      headers: ['team', 'actual', 'target'],
      rows,
      sourceTable: 'monthly_targets',
    });
  };
  const toEntry = (period) => {
    const table = makeTable(period);
    return {
      snapshots: { [sourceId]: table },
      value: (numericValue(table, 'actual') / numericValue(table, 'target')) * 100,
      display: `${((numericValue(table, 'actual') / numericValue(table, 'target')) * 100).toFixed(2)}%`,
    };
  };
  return createCase({
    id: 'B04',
    domain: 'sales',
    title: '목표 달성률',
    goal: '실적과 목표 자료에서 목표 달성률을 찾아라.',
    sources,
    training: [0, 1, 2].map(toEntry),
    holdout: [3, 4].map(toEntry),
    expectedOutcome: 'publish',
    expectedSources: [sourceId],
    expectedExpressions: [ratio(sourceId)],
    holdoutSourceId: sourceId,
  });
}

function buildInvoiceTotal(seed) {
  const sourceId = 'rdb:invoices';
  const sources = [sourceDescriptor(sourceId, '청구서 원장')];
  const makeTable = (period) => {
    const base = 850 + period * 100 + variation(seed, `B05:base:${period}`, 60);
    return tableArtifact({
      id: `snapshot_B05_${period}`,
      name: 'invoices',
      headers: ['invoice_id', 'amount', 'customer'],
      rows: [
        { invoice_id: `inv-${period}-1`, amount: base, customer: 'Acme' },
        { invoice_id: `inv-${period}-2`, amount: null, customer: 'Beta' },
        { invoice_id: `inv-${period}-2-retry`, amount: base, customer: 'Beta' },
        { invoice_id: `inv-${period}-3`, amount: base + 230, customer: 'Cobalt' },
      ],
      sourceTable: 'invoices',
    });
  };
  const toEntry = (period) => {
    const table = makeTable(period);
    return { snapshots: { [sourceId]: table }, value: numericValue(table, 'amount') };
  };
  return createCase({
    id: 'B05',
    domain: 'billing',
    title: 'null·중복이 있는 청구액',
    goal: '누락값과 재시도 행이 있는 청구서에서 총액을 찾아라.',
    sources,
    training: [0, 1, 2].map(toEntry),
    holdout: [3, 4].map(toEntry),
    expectedOutcome: 'publish',
    expectedSources: [sourceId],
    expectedExpressions: [aggregate(sourceId, 'sum', 'amount')],
    holdoutSourceId: sourceId,
  });
}

function buildSubscriptionCount(seed) {
  const sourceId = 'rdb:subscriptions';
  const sources = [sourceDescriptor(sourceId, '구독 목록')];
  const makeTable = (period) => {
    const rows = Array.from({ length: 4 + (period % 2) }, (_, index) => ({
      subscription_id: `sub-${period}-${index + 1}-${variation(seed, `B06:${period}:${index}`, 100)}`,
      monthly_fee: 19000 + index * 5000 + period * 200,
      plan: index % 2 === 0 ? 'pro' : 'basic',
    }));
    return tableArtifact({
      id: `snapshot_B06_${period}`,
      name: 'subscriptions',
      headers: ['subscription_id', 'monthly_fee', 'plan'],
      rows,
      sourceTable: 'subscriptions',
    });
  };
  const toEntry = (period) => {
    const table = makeTable(period);
    return { snapshots: { [sourceId]: table }, value: table.rows.length };
  };
  return createCase({
    id: 'B06',
    domain: 'subscription',
    title: '활성 구독 건수',
    goal: '기간별 구독 건수를 찾아라.',
    sources,
    training: [0, 1, 2].map(toEntry),
    holdout: [3, 4].map(toEntry),
    expectedOutcome: 'publish',
    expectedSources: [sourceId],
    expectedExpressions: [aggregate(sourceId, 'count')],
    holdoutSourceId: sourceId,
  });
}

function buildAmbiguousSources(seed, holdoutDiverges) {
  const firstSource = 'rdb:orders';
  const secondSource = 'rdb:ledger';
  const sources = [
    sourceDescriptor(firstSource, '주문 원장'),
    sourceDescriptor(secondSource, '회계 원장'),
  ];
  const makeTable = (sourceId, period, amountOffset) => {
    const tableName = sourceId === firstSource ? 'orders' : 'ledger';
    const rows = Array.from({ length: 3 }, (_, index) => ({
      entry_id: `${tableName}-${period}-${index + 1}`,
      amount: 1400 + period * 200 + index * 83 + amountOffset,
      label: index === 0 ? 'primary' : 'secondary',
    }));
    return tableArtifact({
      id: `snapshot_${holdoutDiverges ? 'B08' : 'B07'}_${sourceId}_${period}`,
      name: tableName,
      headers: ['entry_id', 'amount', 'label'],
      rows,
      sourceTable: tableName,
    });
  };
  const makeEntry = (period, holdout) => {
    const firstOffset = holdout && holdoutDiverges ? 0 : 0;
    const secondOffset = holdout && holdoutDiverges ? -260 : 0;
    const first = makeTable(firstSource, period, firstOffset);
    const second = makeTable(secondSource, period, secondOffset);
    const value = numericValue(first, 'amount');
    return {
      snapshots: {
        [firstSource]: first,
        [secondSource]: second,
      },
      value,
    };
  };
  const training = [0, 1, 2].map((period) => makeEntry(period, false));
  const holdout = [3, 4].map((period) => makeEntry(period, holdoutDiverges));
  return createCase({
    id: holdoutDiverges ? 'B08' : 'B07',
    domain: holdoutDiverges ? 'finance' : 'support',
    title: holdoutDiverges ? 'holdout에서 갈리는 중복 source' : '같은 결과를 만드는 source',
    goal: holdoutDiverges
      ? '과거 결과가 같은 두 원장 중 어느 source인지 검증하라.'
      : '같은 결과를 만드는 source가 여러 개면 질문하라.',
    sources,
    training,
    holdout,
    expectedOutcome: 'clarify',
    expectedSources: [firstSource, secondSource],
    expectedExpressions: [
      aggregate(firstSource, 'sum', 'amount'),
      aggregate(secondSource, 'sum', 'amount'),
    ],
    holdoutSourceId: holdoutDiverges ? firstSource : undefined,
  });
}

function buildNoMatch(seed) {
  const sourceId = 'rdb:orders';
  const sources = [sourceDescriptor(sourceId, '주문 원장')];
  const training = [];
  const holdout = [];
  for (let period = 0; period < 3; period += 1) {
    const table = makeOrderTable(seed, 'B09', period, 3, 700 + period * 100);
    training.push({ snapshots: { [sourceId]: table }, value: 9_999_999 + period });
  }
  for (let period = 3; period < 5; period += 1) {
    const table = makeOrderTable(seed, 'B09', period, 4, 900 + period * 100);
    holdout.push({ snapshots: { [sourceId]: table }, value: 9_999_999 + period });
  }
  return createCase({
    id: 'B09',
    domain: 'sales',
    title: '매칭되지 않는 결과',
    goal: '연결된 자료에서 결과를 재현할 수 없으면 중단하라.',
    sources,
    training,
    holdout,
    expectedOutcome: 'no_match',
    expectedSources: [],
    expectedExpressions: [],
  });
}

function buildTruncated(seed) {
  const sourceId = 'rdb:invoices';
  const sources = [sourceDescriptor(sourceId, '청구서 원장')];
  const makeEntry = (period) => {
    const fullRows = Array.from({ length: 6 }, (_, index) => ({
      invoice_id: `truncated-${period}-${index + 1}`,
      amount: 900 + period * 100 + index * 70 + variation(seed, `B10:${period}:${index}`, 20),
      customer: index % 2 === 0 ? 'Acme' : 'Beta',
    }));
    const fullValue = fullRows.reduce((sum, row) => sum + row.amount, 0);
    const visibleRows = fullRows.slice(0, 2);
    const table = tableArtifact({
      id: `snapshot_B10_${period}`,
      name: 'invoices',
      headers: ['invoice_id', 'amount', 'customer'],
      rows: visibleRows,
      sourceTable: 'invoices',
      truncated: true,
    });
    return { snapshots: { [sourceId]: table }, value: fullValue };
  };
  return createCase({
    id: 'B10',
    domain: 'billing',
    title: '잘린 snapshot aggregate',
    goal: '불완전한 snapshot으로 합계를 확정하지 마라.',
    sources,
    training: [0, 1, 2].map(makeEntry),
    holdout: [3, 4].map(makeEntry),
    expectedOutcome: 'no_match',
    expectedSources: [],
    expectedExpressions: [],
  });
}

function mutateTables(item, mutate) {
  const clone = structuredClone(item);
  for (const example of [...clone.examples, ...clone.holdout]) {
    for (const [sourceId, snapshot] of Object.entries(example.snapshots)) {
      example.snapshots[sourceId] = mutate(snapshot, sourceId, example.id);
    }
  }
  return clone;
}

function addIrrelevantColumn(snapshot, sourceId, exampleId) {
  const clone = structuredClone(snapshot);
  clone.columns = [
    ...clone.columns,
    { name: 'region', type: 'string', nullable: true, inferred: true },
  ];
  clone.rows = clone.rows
    .map((row, index) => ({
      ...row,
      index,
      values: { ...row.values, region: index % 2 === 0 ? '서울' : '부산' },
    }))
    .reverse()
    .map((row, index) => ({ ...row, index }));
  clone.name = `${clone.name ?? sourceId}:${exampleId}:noise`;
  return clone;
}

function formatNumericColumns(snapshot, columns) {
  const clone = structuredClone(snapshot);
  clone.rows = clone.rows.map((row) => ({
    ...row,
    values: {
      ...row.values,
      ...Object.fromEntries(columns.map((column) => {
        const value = row.values[column];
        return [column, typeof value === 'number' ? value.toLocaleString('en-US') : value];
      })),
    },
  }));
  return clone;
}

function addDistractorSource(item, sourceId, tableMutator) {
  const clone = structuredClone(item);
  clone.sources.push(sourceDescriptor(sourceId, '검증용 보조 원장'));
  for (const example of [...clone.examples, ...clone.holdout]) {
    const reference = example.snapshots[clone.expected.sourceIds[0]];
    example.snapshots[sourceId] = tableMutator(reference, sourceId, example.id);
  }
  return clone;
}

function rotatingCases(seed, base) {
  const noise = mutateTables(base[0], addIrrelevantColumn);
  noise.id = 'B11';
  noise.title = '행·컬럼 순서가 달라진 총매출';
  noise.goal = '불필요한 컬럼과 행 순서가 달라도 총매출을 찾아라.';
  noise.examples.forEach((example) => example.observations.forEach((entry) => {
    entry.id = entry.id.replace('B01', 'B11');
  }));
  noise.holdout.forEach((example) => example.observations.forEach((entry) => {
    entry.id = entry.id.replace('B01', 'B11');
  }));

  const distractor = addDistractorSource(
    base[2],
    'rdb:orders_backup',
    (snapshot, sourceId, exampleId) => {
      const clone = structuredClone(snapshot);
      clone.id = `snapshot_B12_${sourceId}_${exampleId}`;
      clone.name = 'orders_backup';
      clone.source = { ...clone.source, table: 'orders_backup' };
      clone.rows = clone.rows.map((row, index) => ({
        ...row,
        index,
        values: {
          ...row.values,
          amount: typeof row.values.amount === 'number' ? row.values.amount + 431 + index : row.values.amount,
        },
      }));
      return clone;
    },
  );
  distractor.id = 'B12';
  distractor.title = '보조 원장이 함께 있는 평균 주문액';
  distractor.goal = '여러 원장 중 과거 결과를 재현하는 주문 원장을 찾아라.';
  distractor.examples.forEach((example) => example.observations.forEach((entry) => {
    entry.id = entry.id.replace('B03', 'B12');
  }));
  distractor.holdout.forEach((example) => example.observations.forEach((entry) => {
    entry.id = entry.id.replace('B03', 'B12');
  }));

  const formatted = mutateTables(base[3], (snapshot) =>
    addIrrelevantColumn(formatNumericColumns(snapshot, ['actual', 'target']), 'rdb:targets', 'formatted'));
  formatted.id = 'B13';
  formatted.title = '통화 형식과 잡음 컬럼이 있는 목표 달성률';
  formatted.goal = '숫자 표시 형식과 불필요한 컬럼이 달라도 목표 달성률을 찾아라.';
  formatted.examples.forEach((example) => example.observations.forEach((entry) => {
    entry.id = entry.id.replace('B04', 'B13');
  }));
  formatted.holdout.forEach((example) => example.observations.forEach((entry) => {
    entry.id = entry.id.replace('B04', 'B13');
  }));

  const backupCount = addDistractorSource(
    base[5],
    'rdb:subscriptions_backup',
    (snapshot, sourceId, exampleId) => {
      const clone = structuredClone(snapshot);
      clone.id = `snapshot_B14_${sourceId}_${exampleId}`;
      clone.name = 'subscriptions_backup';
      clone.source = { ...clone.source, table: 'subscriptions_backup' };
      clone.rows = [
        ...clone.rows,
        { index: clone.rows.length, values: { subscription_id: 'backup-extra', monthly_fee: 1, plan: 'trial' } },
      ];
      return clone;
    },
  );
  backupCount.id = 'B14';
  backupCount.title = '보조 목록이 있는 활성 구독 건수';
  backupCount.goal = '보조 목록이 있어도 과거 구독 건수를 재현하는 목록을 찾아라.';
  backupCount.examples.forEach((example) => example.observations.forEach((entry) => {
    entry.id = entry.id.replace('B06', 'B14');
  }));
  backupCount.holdout.forEach((example) => example.observations.forEach((entry) => {
    entry.id = entry.id.replace('B06', 'B14');
  }));

  return [noise, distractor, formatted, backupCount].map((item) => {
    item.generatedFrom = `${item.generatedFrom ?? 'base'}:${seed}`;
    return item;
  });
}

function baseCases(seed) {
  return [
    buildSalesTotal(seed),
    buildOrderCount(seed),
    buildAverageOrder(seed),
    buildTargetAttainment(seed),
    buildInvoiceTotal(seed),
    buildSubscriptionCount(seed),
    buildAmbiguousSources(seed, false),
    buildAmbiguousSources(seed, true),
    buildNoMatch(seed),
    buildTruncated(seed),
  ];
}

export function buildCatalog(seed = 'wd-v1', profile = 'v1') {
  const base = baseCases(seed);
  if (profile === 'v1') return base;
  if (profile === 'rotating') return [...base, ...rotatingCases(seed, base)];
  throw new Error(`unknown_benchmark_profile:${profile}`);
}

export function validateCatalog(cases, expectedCount, requiredIds = []) {
  const errors = [];
  const ids = new Set();
  for (const item of cases) {
    if (!item?.id || ids.has(item.id)) errors.push(`duplicate_or_missing_case:${item?.id ?? 'unknown'}`);
    ids.add(item.id);
    if (!Array.isArray(item.examples) || item.examples.length < 2) errors.push(`${item.id}:examples`);
    if (!Array.isArray(item.holdout) || item.holdout.length < 1) errors.push(`${item.id}:holdout`);
    if (!Array.isArray(item.sources) || item.sources.length === 0) errors.push(`${item.id}:sources`);
    const sourceIds = new Set(item.sources?.map((source) => source.id) ?? []);
    if (sourceIds.size !== (item.sources?.length ?? 0)) errors.push(`${item.id}:duplicate_source_ids`);
    if (!['publish', 'clarify', 'no_match'].includes(item.expected?.outcome)) {
      errors.push(`${item.id}:expected_outcome`);
    }
    if (!Array.isArray(item.expected?.sourceIds)) errors.push(`${item.id}:expected_sources`);
    if (!Array.isArray(item.expected?.expressionSignatures)) errors.push(`${item.id}:expected_expressions`);
    for (const sourceId of item.expected?.sourceIds ?? []) {
      if (!sourceIds.has(sourceId)) errors.push(`${item.id}:unknown_expected_source:${sourceId}`);
    }
    const observationIds = new Set(item.examples.flatMap((example) => example.observations.map((entry) => entry.id)));
    if (observationIds.size !== item.examples.length) errors.push(`${item.id}:observation_ids`);
    for (const example of [...(item.examples ?? []), ...(item.holdout ?? [])]) {
      if (!Array.isArray(example.observations) || example.observations.length === 0) errors.push(`${item.id}:${example.id}:observations`);
      for (const observationEntry of example.observations ?? []) {
        if (observationEntry.path !== item.observationPath) errors.push(`${item.id}:${example.id}:observation_path`);
      }
      for (const [sourceId, snapshot] of Object.entries(example.snapshots ?? {})) {
        if (!sourceIds.has(sourceId)) errors.push(`${item.id}:${example.id}:unknown_snapshot_source:${sourceId}`);
        if (snapshot?.kind !== 'table' || !Array.isArray(snapshot?.columns) || !Array.isArray(snapshot?.rows)) {
          errors.push(`${item.id}:${example.id}:invalid_table_snapshot:${sourceId}`);
        }
      }
    }
    if (item.expected?.outcome === 'publish' && (item.expected.expressionSignatures?.length ?? 0) === 0) {
      errors.push(`${item.id}:publish_without_expression`);
    }
    if (item.expected?.outcome !== 'publish' && (item.expected.expressionSignatures?.length ?? 0) > 0 && item.id === 'B09') {
      errors.push(`${item.id}:unexpected_expression`);
    }
  }
  if (expectedCount !== undefined && cases.length !== expectedCount) {
    errors.push(`expected_${expectedCount}_cases:${cases.length}`);
  }
  for (const id of requiredIds) {
    if (!ids.has(id)) errors.push(`required_case_missing:${id}`);
  }
  if (errors.length > 0) throw new Error(`benchmark_contract_invalid:${errors.join(',')}`);
  return { caseCount: cases.length, ids: [...ids] };
}
