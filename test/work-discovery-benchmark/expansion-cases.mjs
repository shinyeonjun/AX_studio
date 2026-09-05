import { buildCatalog as buildBaseCatalog, expressionSignature } from './cases.mjs';

function sum(sourceId, column) {
  return {
    op: 'aggregate',
    input: { op: 'source', sourceId },
    fn: 'sum',
    column,
  };
}

function average(sourceId, column) {
  return {
    op: 'aggregate',
    input: { op: 'source', sourceId },
    fn: 'avg',
    column,
  };
}

function count(sourceId) {
  return {
    op: 'aggregate',
    input: { op: 'source', sourceId },
    fn: 'count',
  };
}

function ratio(sourceId) {
  return {
    op: 'ratio',
    numerator: sum(sourceId, 'actual'),
    denominator: sum(sourceId, 'target'),
    multiplyBy: 100,
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

function eachExample(item, callback) {
  for (const example of [...item.examples, ...item.holdout]) callback(example);
}

function eachSnapshot(item, callback) {
  eachExample(item, (example) => {
    for (const [sourceId, snapshot] of Object.entries(example.snapshots)) {
      example.snapshots[sourceId] = callback(snapshot, sourceId, example);
    }
  });
}

function rewriteObservationIds(item) {
  for (const example of [...item.examples, ...item.holdout]) {
    for (const observation of example.observations) {
      observation.id = `observation_${item.id}_${example.id}`;
    }
  }
}

function setExpected(item, outcome, sourceIds, expressions, holdoutSourceId) {
  item.expected = {
    outcome,
    sourceIds,
    expressionSignatures: expressions.map(expressionSignature),
    holdoutSourceId,
  };
}

function cloneCase(base, { id, title, goal, mutation, mutate, expected, inputFormats, finding }) {
  const item = structuredClone(base);
  item.id = id;
  item.title = title;
  item.goal = goal;
  item.mutation = mutation;
  item.generatedFrom = base.id;
  if (inputFormats) item.inputFormats = inputFormats;
  if (finding) item.finding = finding;
  rewriteObservationIds(item);
  if (expected) setExpected(item, ...expected);
  mutate?.(item);
  return item;
}

function renameColumn(snapshot, from, to) {
  return {
    ...structuredClone(snapshot),
    columns: snapshot.columns.map((column) => column.name === from ? { ...column, name: to } : column),
    rows: snapshot.rows.map((row) => {
      const values = { ...row.values };
      if (Object.prototype.hasOwnProperty.call(values, from)) {
        values[to] = values[from];
        delete values[from];
      }
      return { ...row, values };
    }),
  };
}

function addNullableColumn(snapshot, name, value = null) {
  const clone = structuredClone(snapshot);
  if (!clone.columns.some((column) => column.name === name)) {
    clone.columns.push({ name, type: 'string', nullable: true, inferred: true });
  }
  clone.rows = clone.rows.map((row) => ({
    ...row,
    values: { ...row.values, [name]: value },
  }));
  return clone;
}

function removeColumn(snapshot, name) {
  const clone = structuredClone(snapshot);
  clone.columns = clone.columns.filter((column) => column.name !== name);
  clone.rows = clone.rows.map((row) => {
    const values = { ...row.values };
    delete values[name];
    return { ...row, values };
  });
  return clone;
}

function formatNumericColumns(snapshot, columns, type = undefined) {
  const clone = structuredClone(snapshot);
  clone.columns = clone.columns.map((column) => columns.includes(column.name)
    ? { ...column, ...(type ? { type } : {}) }
    : column);
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

function reverseColumnsAndRows(snapshot) {
  const clone = structuredClone(snapshot);
  clone.columns = [...clone.columns].reverse();
  clone.rows = [...clone.rows].reverse().map((row, index) => ({ ...row, index }));
  return clone;
}

function addSource(item, sourceId, label, buildSnapshot, primarySourceId = item.expected.sourceIds[0]) {
  item.sources.push(sourceDescriptor(sourceId, label));
  eachExample(item, (example) => {
    const primary = example.snapshots[primarySourceId];
    example.snapshots[sourceId] = buildSnapshot(primary, sourceId, example);
  });
}

function addMetadata(item, field, value) {
  eachSnapshot(item, (snapshot) => ({
    ...snapshot,
    source: { ...snapshot.source, [field]: value },
  }));
}

function updateObservationValues(item, phase, update) {
  for (const example of item[phase]) {
    for (const observation of example.observations) update(observation, example);
  }
}

function schemaDriftCases(base) {
  const renamed = cloneCase(base[0], {
    id: 'B15',
    title: '금액 컬럼명이 바뀐 총매출',
    goal: '컬럼명이 바뀌어도 의미가 같은 금액 합계를 찾아라.',
    mutation: 'schema-drift:column-rename',
    expected: ['publish', ['rdb:orders'], [sum('rdb:orders', 'gross_amount')], 'rdb:orders'],
    mutate: (item) => {
      eachSnapshot(item, (snapshot) => {
        const renamedSnapshot = renameColumn(snapshot, 'amount', 'gross_amount');
        renamedSnapshot.name = 'orders_v2';
        renamedSnapshot.source = { ...renamedSnapshot.source, table: 'orders_v2' };
        return renamedSnapshot;
      });
    },
  });

  const nullableChanges = cloneCase(base[1], {
    id: 'B16',
    title: 'nullable 필드가 달라진 주문 건수',
    goal: '기간마다 nullable 부가 필드가 달라도 주문 건수를 찾아라.',
    mutation: 'schema-drift:nullable-column-change',
    expected: ['publish', ['rdb:orders'], [count('rdb:orders')], 'rdb:orders'],
    mutate: (item) => {
      item.examples.slice(0, 2).forEach((example) => {
        for (const sourceId of Object.keys(example.snapshots)) {
          example.snapshots[sourceId] = addNullableColumn(example.snapshots[sourceId], 'customer_note');
        }
      });
    },
  });

  const typedStrings = cloneCase(base[3], {
    id: 'B17',
    title: '숫자 타입이 문자열로 들어온 목표 달성률',
    goal: '숫자가 쉼표 문자열로 전달되어도 목표 달성률을 검증하라.',
    mutation: 'schema-drift:numeric-to-formatted-string',
    expected: ['publish', ['rdb:targets'], [ratio('rdb:targets')], 'rdb:targets'],
    mutate: (item) => {
      eachSnapshot(item, (snapshot) => formatNumericColumns(snapshot, ['actual', 'target'], 'string'));
    },
  });

  const columnsChanged = cloneCase(base[4], {
    id: 'B18',
    title: 'holdout에서 보조 컬럼이 사라진 청구액',
    goal: '사용하지 않는 컬럼이 추가·삭제되어도 청구액 합계를 찾아라.',
    mutation: 'schema-drift:column-add-delete',
    expected: ['publish', ['rdb:invoices'], [sum('rdb:invoices', 'amount')], 'rdb:invoices'],
    mutate: (item) => {
      item.examples.forEach((example) => {
        for (const sourceId of Object.keys(example.snapshots)) {
          example.snapshots[sourceId] = addNullableColumn(example.snapshots[sourceId], 'currency', 'KRW');
        }
      });
      item.holdout.forEach((example) => {
        for (const sourceId of Object.keys(example.snapshots)) {
          example.snapshots[sourceId] = removeColumn(example.snapshots[sourceId], 'customer');
        }
      });
    },
  });

  return [renamed, nullableChanges, typedStrings, columnsChanged];
}

function sourceConfusionCases(base) {
  const identical = cloneCase(base[0], {
    id: 'B19',
    title: '동일 결과의 backup source',
    goal: '같은 결과를 만드는 원장이 여러 개면 확정하지 마라.',
    mutation: 'source-confusion:identical-backup',
    expected: ['clarify', ['rdb:orders', 'rdb:orders_backup'], [sum('rdb:orders', 'amount'), sum('rdb:orders_backup', 'amount')]],
    mutate: (item) => addSource(item, 'rdb:orders_backup', '오래된 주문 backup', (snapshot) => structuredClone(snapshot)),
  });

  const nearMatch = cloneCase(base[2], {
    id: 'B20',
    title: '유사하지만 다른 backup source',
    goal: '값이 비슷한 backup보다 실제 결과를 재현하는 주문 원장을 선택하라.',
    mutation: 'source-confusion:near-match-backup',
    expected: ['publish', ['rdb:orders'], [average('rdb:orders', 'amount')], 'rdb:orders'],
    mutate: (item) => addSource(item, 'rdb:orders_archive', '보관 주문 원장', (snapshot, sourceId, example) => ({
      ...structuredClone(snapshot),
      id: `${snapshot.id}_${sourceId}_${example.id}`,
      name: 'orders_archive',
      source: { ...snapshot.source, table: 'orders_archive' },
      rows: snapshot.rows.map((row, index) => ({
        ...row,
        values: {
          ...row.values,
          amount: typeof row.values.amount === 'number' ? row.values.amount + 17 + index : row.values.amount,
        },
      })),
    })),
  });

  const missingPrimary = cloneCase(base[1], {
    id: 'B21',
    title: '훈련 중 올바른 source가 누락된 주문 건수',
    goal: '올바른 원장의 snapshot이 하나라도 없으면 확정하지 마라.',
    mutation: 'source-confusion:missing-primary-snapshot',
    expected: ['no_match', [], []],
    mutate: (item) => {
      addSource(item, 'rdb:orders_backup', '행이 추가된 주문 backup', (snapshot, sourceId, example) => ({
        ...structuredClone(snapshot),
        id: `${snapshot.id}_${sourceId}_${example.id}`,
        name: 'orders_backup',
        source: { ...snapshot.source, table: 'orders_backup' },
        rows: [
          ...snapshot.rows,
          { index: snapshot.rows.length, values: { order_id: 'backup-extra', amount: 1, status: 'pending' } },
        ],
      }), 'rdb:orders');
      delete item.examples[1].snapshots['rdb:orders'];
    },
  });

  const truncatedBackup = cloneCase(base[4], {
    id: 'B22',
    title: '잘린 backup이 있는 청구액',
    goal: '불완전한 backup 원장이 결과를 대신하지 않게 하라.',
    mutation: 'source-confusion:truncated-backup',
    expected: ['publish', ['rdb:invoices'], [sum('rdb:invoices', 'amount')], 'rdb:invoices'],
    mutate: (item) => addSource(item, 'rdb:invoices_backup', '잘린 청구서 backup', (snapshot, sourceId, example) => ({
      ...structuredClone(snapshot),
      id: `${snapshot.id}_${sourceId}_${example.id}`,
      name: 'invoices_backup',
      truncated: true,
      source: { ...snapshot.source, table: 'invoices_backup' },
    })),
  });

  return [identical, nearMatch, missingPrimary, truncatedBackup];
}

function holdoutCases(base) {
  const holdoutAmbiguity = cloneCase(base[0], {
    id: 'B23',
    title: 'holdout에서 갈리는 두 매출 원장',
    goal: '훈련 결과만으로 source가 결정되지 않으면 질문하라.',
    mutation: 'holdout:source-divergence',
    expected: ['clarify', ['rdb:orders', 'rdb:orders_legacy'], [sum('rdb:orders', 'amount'), sum('rdb:orders_legacy', 'amount')]],
    mutate: (item) => {
      addSource(item, 'rdb:orders_legacy', '구형 주문 원장', (snapshot, sourceId, example) => ({
        ...structuredClone(snapshot),
        id: `${snapshot.id}_${sourceId}_${example.id}`,
        name: 'orders_legacy',
        source: { ...snapshot.source, table: 'orders_legacy' },
        rows: example.phase === 'holdout'
          ? snapshot.rows.map((row, index) => ({
            ...row,
            values: {
              ...row.values,
              amount: typeof row.values.amount === 'number' ? row.values.amount + 500 + index : row.values.amount,
            },
          }))
          : snapshot.rows,
      }));
    },
  });

  const overfitOutput = cloneCase(base[0], {
    id: 'B24',
    title: '훈련에는 맞지만 holdout에서 깨지는 합계',
    goal: '훈련 사례에만 맞는 후보를 holdout에서 확정하지 마라.',
    mutation: 'holdout:overfit-output',
    expected: ['no_match', [], []],
    finding: {
      class: 'algorithmic_limitation',
      label: 'hidden holdout changes the target transformation; training evidence cannot identify that future change',
    },
    mutate: (item) => updateObservationValues(item, 'holdout', (observation, example) => {
      const rowCount = item.holdout.find((candidate) => candidate.id === example.id)?.snapshots['rdb:orders'].rows.length ?? 0;
      observation.value = { kind: 'number', value: rowCount, display: String(rowCount) };
    }),
  });

  const missingHoldout = cloneCase(base[2], {
    id: 'B25',
    title: 'holdout source가 사라진 평균 주문액',
    goal: '새 사례의 source가 없으면 기존 후보를 확정하지 마라.',
    mutation: 'holdout:missing-source',
    expected: ['no_match', [], []],
    finding: {
      class: 'missing_product_capability',
      label: 'future source availability is not part of the discovery-time evidence or current product contract',
    },
    mutate: (item) => {
      delete item.holdout[1].snapshots['rdb:orders'];
    },
  });

  const zeroDenominator = cloneCase(base[3], {
    id: 'B26',
    title: 'holdout 목표값이 0인 달성률',
    goal: '분모가 0인 holdout을 정상 달성률로 확정하지 마라.',
    mutation: 'holdout:zero-denominator',
    expected: ['no_match', [], []],
    finding: {
      class: 'missing_product_capability',
      label: 'future denominator data quality is not part of the discovery-time evidence or current product contract',
    },
    mutate: (item) => {
      for (const example of item.holdout) {
        const snapshot = example.snapshots['rdb:targets'];
        snapshot.rows = snapshot.rows.map((row) => ({
          ...row,
          values: { ...row.values, target: 0 },
        }));
        const observation = example.observations[0];
        observation.value = { kind: 'number', value: 0, display: '0%' };
      }
    },
  });

  return [holdoutAmbiguity, overfitOutput, missingHoldout, zeroDenominator];
}

function inputVariationCases(base) {
  const csv = cloneCase(base[0], {
    id: 'B27',
    title: 'CSV 행·컬럼 순서가 달라진 총매출',
    goal: 'CSV 입력의 행·컬럼 순서가 달라도 총매출을 찾아라.',
    mutation: 'input-variation:csv-order',
    inputFormats: ['csv'],
    expected: ['publish', ['rdb:orders'], [sum('rdb:orders', 'amount')], 'rdb:orders'],
    mutate: (item) => eachSnapshot(item, reverseColumnsAndRows),
  });

  const xlsx = cloneCase(base[1], {
    id: 'B28',
    title: 'XLSX sheet 메타데이터가 있는 주문 건수',
    goal: 'XLSX sheet provenance가 붙어도 주문 건수를 찾아라.',
    mutation: 'input-variation:xlsx-sheet',
    inputFormats: ['xlsx'],
    expected: ['publish', ['rdb:orders'], [count('rdb:orders')], 'rdb:orders'],
    mutate: (item) => {
      addMetadata(item, 'workbookSheet', 'Orders');
      eachSnapshot(item, reverseColumnsAndRows);
    },
  });

  const postgres = cloneCase(base[4], {
    id: 'B29',
    title: 'PostgreSQL null·중복 청구액',
    goal: 'PostgreSQL snapshot provenance와 null·중복 행이 있어도 청구액을 찾아라.',
    mutation: 'input-variation:postgresql-snapshot',
    inputFormats: ['postgresql'],
    expected: ['publish', ['rdb:invoices'], [sum('rdb:invoices', 'amount')], 'rdb:invoices'],
    mutate: (item) => {
      addMetadata(item, 'database', 'benchmark_postgres');
      addMetadata(item, 'queryFingerprint', 'sha256:benchmark-invoices');
    },
  });

  const pdf = cloneCase(base[5], {
    id: 'B30',
    title: 'PDF 표 추출 provenance가 있는 구독 건수',
    goal: 'PDF 표 추출 결과의 provenance가 있어도 구독 건수를 찾아라.',
    mutation: 'input-variation:pdf-output',
    inputFormats: ['pdf'],
    expected: ['publish', ['rdb:subscriptions'], [count('rdb:subscriptions')], 'rdb:subscriptions'],
    mutate: (item) => addMetadata(item, 'filePath', 'subscription-report.pdf'),
  });

  return [csv, xlsx, postgres, pdf];
}

export const PROFILE_CASE_COUNTS = Object.freeze({
  v1: 10,
  rotating: 14,
  'schema-drift': 14,
  'source-confusion': 14,
  holdout: 14,
  'input-variation': 14,
  expanded: 30,
});

export const PROFILE_REQUIRED_CASE_IDS = Object.freeze({
  v1: [],
  rotating: ['B11', 'B12', 'B13', 'B14'],
  'schema-drift': ['B15', 'B16', 'B17', 'B18'],
  'source-confusion': ['B19', 'B20', 'B21', 'B22'],
  holdout: ['B23', 'B24', 'B25', 'B26'],
  'input-variation': ['B27', 'B28', 'B29', 'B30'],
  expanded: [
    'B11', 'B12', 'B13', 'B14',
    'B15', 'B16', 'B17', 'B18',
    'B19', 'B20', 'B21', 'B22',
    'B23', 'B24', 'B25', 'B26',
    'B27', 'B28', 'B29', 'B30',
  ],
});

export function expectedCaseCount(profile) {
  const count = PROFILE_CASE_COUNTS[profile];
  if (!count) throw new Error(`unknown_benchmark_profile:${profile}`);
  return count;
}

export function requiredCaseIds(profile) {
  const ids = PROFILE_REQUIRED_CASE_IDS[profile];
  if (!ids) throw new Error(`unknown_benchmark_profile:${profile}`);
  return ids;
}

export function buildCatalogForProfile(seed, profile = 'v1') {
  const base = buildBaseCatalog(seed, 'v1');
  switch (profile) {
    case 'v1':
      return base;
    case 'rotating':
      return buildBaseCatalog(seed, 'rotating');
    case 'schema-drift':
      return [...base, ...schemaDriftCases(base)];
    case 'source-confusion':
      return [...base, ...sourceConfusionCases(base)];
    case 'holdout':
      return [...base, ...holdoutCases(base)];
    case 'input-variation':
      return [...base, ...inputVariationCases(base)];
    case 'expanded':
      return [
        ...base,
        ...buildCatalogForProfile(seed, 'rotating').slice(base.length),
        ...schemaDriftCases(base),
        ...sourceConfusionCases(base),
        ...holdoutCases(base),
        ...inputVariationCases(base),
      ];
    default:
      throw new Error(`unknown_benchmark_profile:${profile}`);
  }
}
