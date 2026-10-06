import { describe, expect, it } from 'vitest';
import { buildTableArtifact } from '../../contracts/artifacts/table-build.js';
import type { TableArtifact } from '../../contracts/artifacts/table.js';
import { evaluateTransformExpr } from '../../workflow/transform-expr/evaluator.js';
import { TransformExprSchema } from '../../workflow/transform-expr/dsl.js';
import { observeTableArtifact } from '../observation/observe-table.js';
import { keyColumnSets, tableKeyColumns } from '../observation/table-key.js';
import type { OutputObservation } from '../observation/schema.js';
import type { SourceDescriptor } from '../schema.js';
import { formatMappingLabel } from '../view.js';
import { compareObservationValue } from './compare.js';
import { enumerateCandidates } from './enumerator.js';
import { replayCandidates } from './replay-runner.js';
import { resolveReplayWinners } from './resolve-winners.js';
import { roundHalfUp, Rng } from './synthetic-report.fixture.js';

/** Fixed in CI so failures reproduce; every assertion names its seed. */
const SEEDS = Array.from({ length: Number(process.env.AX_SYNTH_SEEDS ?? 40) }, (_, index) => 311 + index * 6151);
const SOURCE_ID = 'input:orders';

const OUTER_NAMES = ['지역', 'Region', '지점', 'branch', '본부', 'channel', '채널'];
const INNER_NAMES = ['카테고리', 'category', '품목', 'product_line', '분류', 'segment'];
const OUTER_VALUES = ['서울', '부산', '대구', '광주', 'East', 'West', 'North', 'Online', 'Retail', '제주'];
const INNER_VALUES = ['식품', '의류', '가전', '문구', '도서', 'Beauty', 'Sports', 'Garden', 'Pet', '완구', '가구'];
const AMOUNT_NAMES = ['금액', 'amount', '매출액', 'Sales'];
const QUANTITY_NAMES = ['수량', 'qty', 'units'];
const STATUS_NAMES = ['상태', 'status', 'order_state'];
const STATUS_SETS = [['완료', '취소'], ['done', 'void', 'pending'], ['정상', '반품', '보류']];
const TOTAL_LABELS = ['합계', 'Total', '총계', 'ALL', 'Σ'];

type MeasureFn = 'sum' | 'count' | 'avg' | 'max';

interface NestedWorld {
  seed: number;
  outer: string;
  inner: string;
  amount: string;
  quantity: string;
  status: string;
  statusValues: string[];
  /** Rows with this status are left out of the report. */
  excluded?: string;
  outerValues: string[];
  innerValues: string[];
  /** Report column order: outer key first, or inner key first. */
  innerFirst: boolean;
  outerHeader: string;
  innerHeader: string;
  measures: Array<{ header: string; fn: MeasureFn; column?: string; round?: number }>;
  totalLabel?: string;
}

function createWorld(seed: number): NestedWorld {
  const rng = new Rng(seed);
  const statusValues = rng.pick(STATUS_SETS);
  const amount = rng.pick(AMOUNT_NAMES);
  const quantity = rng.pick(QUANTITY_NAMES);
  const measureChoices: NestedWorld['measures'] = [
    { header: '건수', fn: 'count' },
    { header: `${amount} 합계`, fn: 'sum', column: amount },
    { header: '평균 금액', fn: 'avg', column: amount, round: 0 },
    { header: '최대 수량', fn: 'max', column: quantity },
  ];
  return {
    seed,
    outer: rng.pick(OUTER_NAMES),
    inner: rng.pick(INNER_NAMES),
    amount,
    quantity,
    status: rng.pick(STATUS_NAMES),
    statusValues,
    ...(rng.bool(0.5) ? { excluded: statusValues[statusValues.length - 1]! } : {}),
    outerValues: rng.sample(OUTER_VALUES, rng.int(2, 4)),
    innerValues: rng.sample(INNER_VALUES, rng.int(3, 5)),
    innerFirst: rng.bool(0.3),
    outerHeader: rng.pick(['구분', 'Region', '지역명', '센터']),
    innerHeader: rng.pick(['항목', 'Category', '품목명', '분류명']),
    measures: rng.sample(measureChoices, rng.int(1, 3)),
    ...(rng.bool(0.5) ? { totalLabel: rng.pick(TOTAL_LABELS) } : {}),
  };
}

function describeWorld(world: NestedWorld): string {
  return JSON.stringify({ outer: world.outer, inner: world.inner, excluded: world.excluded, innerFirst: world.innerFirst,
    measures: world.measures.map((measure) => measure.fn), total: world.totalLabel });
}

/** Source rows for one month: pairs come and go between months, as real data does. */
function buildSource(world: NestedWorld, month: 'A' | 'B'): TableArtifact {
  const rng = new Rng(world.seed * 31 + (month === 'A' ? 1 : 2));
  const pairs = world.outerValues.flatMap((outer) => world.innerValues.map((inner) => [outer, inner] as const))
    .filter(() => rng.bool(0.7));
  if (pairs.length < 2) pairs.push([world.outerValues[0]!, world.innerValues[0]!], [world.outerValues[1]!, world.innerValues[1]!]);
  const headers = rng.shuffle([world.outer, world.inner, world.amount, world.quantity, world.status, '주문번호']);
  const matrix: unknown[][] = [];
  let id = 1;
  for (const [outer, inner] of pairs) {
    for (let count = rng.int(1, 5); count > 0; count -= 1) {
      const values: Record<string, unknown> = {
        [world.outer]: outer,
        [world.inner]: inner,
        [world.amount]: rng.int(1, 400) * 100 + rng.int(0, 99),
        [world.quantity]: rng.int(1, 30),
        [world.status]: rng.pick(world.statusValues),
        주문번호: `${month}-${id++}`,
      };
      matrix.push(headers.map((header) => values[header]));
    }
  }
  return buildTableArtifact({ id: SOURCE_ID, headers, matrix, rowLimit: 10_000 });
}

/** The report computed directly from the rules, independent of the code under test. */
function buildReport(world: NestedWorld, source: TableArtifact): TableArtifact {
  const kept = source.rows.filter((row) => world.excluded === undefined || row.values[world.status] !== world.excluded);
  const measure = (rows: typeof kept, spec: NestedWorld['measures'][number]): number => {
    if (spec.fn === 'count') return rows.length;
    const values = rows.map((row) => row.values[spec.column!] as number);
    if (spec.fn === 'sum') return values.reduce((sum, value) => sum + value, 0);
    if (spec.fn === 'max') return values.reduce((max, value) => Math.max(max, value), -Infinity);
    return roundHalfUp(values.reduce((sum, value) => sum + value, 0) / values.length, spec.round ?? 0);
  };
  const groups = new Map<string, typeof kept>();
  for (const row of kept) {
    const key = JSON.stringify([row.values[world.outer], row.values[world.inner]]);
    groups.set(key, [...(groups.get(key) ?? []), row]);
  }
  const keyHeaders = world.innerFirst ? [world.innerHeader, world.outerHeader] : [world.outerHeader, world.innerHeader];
  const headers = [...keyHeaders, ...world.measures.map((spec) => spec.header)];
  const matrix: unknown[][] = [...groups].map(([key, rows]) => {
    const [outer, inner] = JSON.parse(key) as [string, string];
    return [...(world.innerFirst ? [inner, outer] : [outer, inner]), ...world.measures.map((spec) => measure(rows, spec))];
  });
  if (world.totalLabel) matrix.push([world.totalLabel, null, ...world.measures.map((spec) => measure(kept, spec))]);
  return buildTableArtifact({ id: 'report', name: '지역별 품목 실적', headers, matrix, scalarPolicy: 'preserve' });
}

function learn(observations: OutputObservation[], source: TableArtifact) {
  const sources = { [SOURCE_ID]: source };
  const descriptors = [{ id: SOURCE_ID, connector: 'input_artifact', label: SOURCE_ID }] as SourceDescriptor[];
  const replayed = replayCandidates({
    candidates: enumerateCandidates(observations, descriptors, sources),
    examples: [{ exampleId: 'ex-A', observations }],
    snapshotsByExample: { 'ex-A': sources },
  });
  const resolved = resolveReplayWinners(replayed, [...new Set(observations.map((entry) => entry.path))]);
  return resolved.candidates.filter((entry) => entry.status === 'accepted');
}

function reportObservation(report: TableArtifact, exampleId = 'ex-A'): OutputObservation {
  const observations = observeTableArtifact(exampleId, report);
  expect(observations).toHaveLength(1);
  expect(observations[0]!.value.kind).toBe('table');
  return observations[0]!;
}

describe('two-level group synthesis generalizes across synthetic months', () => {
  it.each(SEEDS)('seed %i: a region x category report learned on month A reproduces month B', (seed) => {
    const world = createWorld(seed);
    const context = `seed ${seed} ${describeWorld(world)}`;
    const sourceA = buildSource(world, 'A');
    const sourceB = buildSource(world, 'B');
    const observation = reportObservation(buildReport(world, sourceA));

    const winners = learn([observation], sourceA);
    expect(winners, `${context}: no unique rule`).toHaveLength(1);
    const expr = winners[0]!.expr;
    expect(TransformExprSchema.safeParse(expr).success, context).toBe(true);
    // Keys come from the data at run time; no example value is frozen into the rule.
    const serialized = JSON.stringify(expr);
    for (const value of [...world.outerValues, ...world.innerValues]) {
      expect(serialized.includes(JSON.stringify(value)), `${context}: froze ${value}`).toBe(false);
    }

    const truthB = reportObservation(buildReport(world, sourceB), 'ex-B');
    const actualB = evaluateTransformExpr(expr, { [SOURCE_ID]: sourceB });
    expect(compareObservationValue(truthB.value, actualB), `${context}: ${formatMappingLabel({ expr })}`).toBe(1);
  });
});

describe('two-level group synthesis refuses what the data does not support', () => {
  const world = createWorld(SEEDS[0]!);
  const source = buildSource(world, 'A');

  it('learns nothing when the numbers are not per-pair aggregates', () => {
    const report = buildReport({ ...world, measures: [{ header: '건수', fn: 'count' }], totalLabel: undefined }, source);
    const scrambled = buildTableArtifact({
      id: 'report',
      name: '지역별 품목 실적',
      headers: report.columns.map((column) => column.name),
      matrix: report.rows.map((row, index) => [...report.columns.slice(0, 2).map((column) => row.values[column.name]), 1000 + index * 7]),
      scalarPolicy: 'preserve',
    });
    expect(learn([reportObservation(scrambled)], source)).toEqual([]);
  });

  it('does not invent a total row whose label sits in the nested key column', () => {
    const report = buildReport({ ...world, totalLabel: undefined, innerFirst: false }, source);
    const headers = report.columns.map((column) => column.name);
    const total = [null, '합계', ...world.measures.map(() => 0)];
    const shifted = buildTableArtifact({
      id: 'report', name: '지역별 품목 실적', headers,
      matrix: [...report.rows.map((row) => headers.map((header) => row.values[header])), total],
      scalarPolicy: 'preserve',
    });
    for (const winner of learn([reportObservation(shifted)], source)) {
      expect(winner.expr.op === 'group' && winner.expr.totalRow).toBeFalsy();
    }
  });
});

describe('table keys', () => {
  it('prefers one distinct column and otherwise the smallest identifying combination', () => {
    const single = { columns: ['구분', '매출'], rows: [{ 구분: 'A', 매출: 1 }, { 구분: 'B', 매출: 2 }] };
    expect(tableKeyColumns(single)).toEqual(['구분']);
    const nested = {
      columns: ['지역', '품목', '비고', '매출'],
      rows: [
        { 지역: '서울', 품목: '식품', 비고: 'x', 매출: 1 },
        { 지역: '서울', 품목: '의류', 비고: 'x', 매출: 2 },
        { 지역: '부산', 품목: '식품', 비고: 'y', 매출: 3 },
        { 지역: '합계', 품목: null, 비고: null, 매출: 6 },
      ],
    };
    expect(keyColumnSets(nested)).toEqual([['지역', '품목']]);
    const unidentifiable = { columns: ['지역', '매출'], rows: [{ 지역: '서울', 매출: 1 }, { 지역: '서울', 매출: 2 }] };
    expect(tableKeyColumns(unidentifiable)).toBeUndefined();
  });

  it('matches nested report rows by both keys in any order', () => {
    const expected = { kind: 'table' as const, columns: ['지역', '품목', '매출'], rows: [
      { 지역: '서울', 품목: '식품', 매출: 1 }, { 지역: '서울', 품목: '의류', 매출: 2 }, { 지역: '부산', 품목: '식품', 매출: 3 },
    ] };
    const reordered = { columns: ['품목', '지역', '매출'], rows: [
      { 지역: '부산', 품목: '식품', 매출: 3 }, { 지역: '서울', 품목: '의류', 매출: 2 }, { 지역: '서울', 품목: '식품', 매출: 1 },
    ] };
    expect(compareObservationValue(expected, reordered)).toBe(1);
    const swapped = { ...reordered, rows: reordered.rows.map((row) => row.품목 === '의류' ? { ...row, 매출: 3 } : row.지역 === '부산' ? { ...row, 매출: 2 } : row) };
    expect(compareObservationValue(expected, swapped)).toBe(0);
  });
});
