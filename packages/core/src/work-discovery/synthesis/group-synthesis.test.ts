import { describe, expect, it } from 'vitest';
import { buildTableArtifact } from '../../contracts/artifacts/table-build.js';
import type { TableArtifact } from '../../contracts/artifacts/table.js';
import { evaluateTransformExpr } from '../../workflow/transform-expr/evaluator.js';
import type { TransformExpr } from '../../workflow/transform-expr/dsl.js';
import { buildClarificationQuestion } from '../clarification/question.js';
import { observeTableArtifact } from '../observation/observe-table.js';
import type { OutputObservation } from '../observation/schema.js';
import type { SourceDescriptor } from '../schema.js';
import { formatMappingLabel } from '../view.js';
import { compareObservationValue } from './compare.js';
import { enumerateCandidates } from './enumerator.js';
import { replayCandidates } from './replay-runner.js';
import { resolveReplayWinners } from './resolve-winners.js';
import { buildMonth, createWorld, describeWorld, type SyntheticWorld } from './synthetic-report.fixture.js';

/** Fixed in CI so failures reproduce; every assertion names its seed. */
const SEEDS = Array.from({ length: Number(process.env.AX_SYNTH_SEEDS ?? 48) }, (_, index) => 101 + index * 7919);
const SOURCE_ID = 'input:orders';

function learn(observations: OutputObservation[], sources: Record<string, TableArtifact>) {
  const descriptors = Object.keys(sources).map((id) => ({ id, connector: 'input_artifact', label: id }) as SourceDescriptor);
  const candidates = enumerateCandidates(observations, descriptors, sources);
  const replayed = replayCandidates({
    candidates,
    examples: [{ exampleId: 'ex-A', observations }],
    snapshotsByExample: { 'ex-A': sources },
  });
  const required = [...new Set(observations.filter((entry) => entry.required).map((entry) => entry.path))];
  const resolved = resolveReplayWinners(replayed, required);
  const accepted = (path: string) => resolved.candidates.filter((entry) => entry.status === 'accepted' && entry.observationPath === path);
  return { candidates, resolved, accepted };
}

function tableObservation(observations: OutputObservation[]): OutputObservation {
  const found = observations.find((entry) => entry.value.kind === 'table');
  if (!found) throw new Error('no table observation');
  return found;
}

function sameNumber(left: unknown, right: unknown): boolean {
  return typeof left === 'number' && typeof right === 'number'
    && Math.abs(left - right) <= 1e-9 * Math.max(1, Math.abs(left), Math.abs(right));
}

/** Exact, order-insensitive equality of two report tables keyed by `keyColumn`; returns why not. */
function tableMismatch(expected: TableArtifact, actual: unknown, keyColumn: string): string | undefined {
  const table = actual as TableArtifact;
  if (!table || !Array.isArray(table.rows)) return `not a table: ${JSON.stringify(actual)}`;
  const expectedColumns = expected.columns.map((column) => column.name).sort();
  const actualColumns = table.columns.map((column) => column.name).sort();
  if (JSON.stringify(expectedColumns) !== JSON.stringify(actualColumns)) return `columns ${actualColumns} != ${expectedColumns}`;
  if (table.rows.length !== expected.rows.length) return `rows ${table.rows.length} != ${expected.rows.length}`;
  for (const row of expected.rows) {
    const key = String(row.values[keyColumn]);
    const match = table.rows.filter((entry) => String(entry.values[keyColumn]) === key);
    if (match.length !== 1) return `key ${key} matched ${match.length} rows`;
    for (const column of expectedColumns) {
      if (column === keyColumn) continue;
      if (!sameNumber(match[0]!.values[column], row.values[column])) {
        return `${key}.${column}: ${match[0]!.values[column]} != ${row.values[column]}`;
      }
    }
  }
  return undefined;
}

function observeMonth(month: ReturnType<typeof buildMonth>): OutputObservation[] {
  return [...observeTableArtifact('ex-A', month.report), ...observeTableArtifact('ex-A', month.summary)];
}

describe('group synthesis generalizes across synthetic months', () => {
  it.each(SEEDS)('seed %i: learned on month A reproduces the true month B report exactly', (seed) => {
    const world = createWorld(seed);
    const context = `seed ${seed} ${describeWorld(world)}`;
    const monthA = buildMonth(world, 'A');
    const monthB = buildMonth(world, 'B');
    // The generator really moves categories between months.
    expect(monthB.categories.filter((name) => !monthA.categories.includes(name)), context).toHaveLength(1);
    expect(monthA.categories.filter((name) => !monthB.categories.includes(name)), context).toHaveLength(1);

    const observations = observeMonth(monthA);
    const table = tableObservation(observations);
    const { accepted, resolved } = learn(observations, { [SOURCE_ID]: monthA.source });
    expect(resolved.ambiguousPaths, context).toEqual([]);

    const groupWinners = accepted(table.path);
    expect(groupWinners, `${context}: no unique group rule`).toHaveLength(1);
    const expr = groupWinners[0]!.expr;
    // The key set must come from data at run time, never from the example month.
    const serialized = JSON.stringify(expr);
    for (const category of monthA.categories) expect(serialized.includes(JSON.stringify(category)), `${context}: froze ${category}`).toBe(false);
    if (world.excludedStatus === undefined) expect(expr.op === 'group' && expr.input.op, context).toBe('source');

    const actualB = evaluateTransformExpr(expr, { [SOURCE_ID]: monthB.source });
    expect(tableMismatch(monthB.report, actualB, world.reportKeyHeader), `${context}: ${formatMappingLabel({ expr })}`).toBeUndefined();
    const observedB = tableObservation(observeTableArtifact('ex-B', monthB.report));
    expect(compareObservationValue(observedB.value, actualB), context).toBeGreaterThanOrEqual(0.95);

    // The summary's scalars use the same kept rows and must generalize too.
    for (const observation of observations.filter((entry) => entry.value.kind === 'number')) {
      const winners = accepted(observation.path);
      expect(winners, `${context}: ${observation.path}`).toHaveLength(1);
      const header = observation.label!;
      const actual = evaluateTransformExpr(winners[0]!.expr, { [SOURCE_ID]: monthB.source });
      expect(sameNumber(actual, monthB.summary.rows[0]!.values[header]), `${context}: ${header} ${actual} vs ${monthB.summary.rows[0]!.values[header]}`).toBe(true);
    }
  });
});

describe('group synthesis rejects coincidences and ambiguity', () => {
  const trapSeeds = SEEDS.slice(0, 12);

  function withReport(month: ReturnType<typeof buildMonth>, mutate: (matrix: unknown[][], headers: string[]) => unknown[][]): TableArtifact {
    const headers = month.report.columns.map((column) => column.name);
    const matrix = month.report.rows.map((row) => headers.map((header) => row.values[header]));
    return buildTableArtifact({ id: 'trap', name: month.report.name, headers, matrix: mutate(matrix, headers) });
  }

  function groupCandidates(report: TableArtifact, sources: Record<string, TableArtifact>) {
    const observations = observeTableArtifact('ex-A', report);
    const table = tableObservation(observations);
    return enumerateCandidates(observations, Object.keys(sources).map((id) => ({ id }) as SourceDescriptor), sources)
      .filter((candidate) => candidate.observationPath === table.path);
  }

  function measureIndex(world: SyntheticWorld, headers: string[]): number {
    return headers.findIndex((header) => header !== world.reportKeyHeader);
  }

  it.each(trapSeeds)('seed %i: one wrong cell means no rule', (seed) => {
    const world = createWorld(seed);
    const month = buildMonth(world, 'A');
    const report = withReport(month, (matrix, headers) => {
      const column = measureIndex(world, headers);
      return matrix.map((row, index) => index === 0 ? row.map((cell, at) => at === column ? Number(cell) + 1 : cell) : row);
    });
    expect(groupCandidates(report, { [SOURCE_ID]: month.source }), `seed ${seed}`).toEqual([]);
  });

  it.each(trapSeeds)('seed %i: an extra row is a total only when its arithmetic checks out', (seed) => {
    const world = { ...createWorld(seed), totalLabel: undefined };
    const month = buildMonth(world, 'A');
    const headers = month.report.columns.map((column) => column.name);
    const keyIndex = headers.indexOf(world.reportKeyHeader);
    const totals = headers.map((header, index) => index === keyIndex
      ? 'Row X'
      : month.report.rows.reduce((sum, row) => sum + Number(row.values[header]), 0));
    const summable = world.measures.every((measure) => measure.fn === 'count' || measure.fn === 'sum');
    // A row of true column sums is accepted as a total exactly when every measure is additive.
    const honest = withReport(month, (matrix) => [...matrix, totals]);
    expect(groupCandidates(honest, { [SOURCE_ID]: month.source }).length > 0, `seed ${seed} ${describeWorld(world)}`).toBe(summable);
    const fake = withReport(month, (matrix) => [...matrix, totals.map((cell, index) => index === keyIndex ? cell : Number(cell) + 1)]);
    expect(groupCandidates(fake, { [SOURCE_ID]: month.source }), `seed ${seed}`).toEqual([]);
    const two = withReport(month, (matrix) => [...matrix, totals, totals.map((cell, index) => index === keyIndex ? 'Row Y' : cell)]);
    expect(groupCandidates(two, { [SOURCE_ID]: month.source }), `seed ${seed}`).toEqual([]);
  });

  it.each(trapSeeds)('seed %i: report keys the source does not hold, or a dropped group, mean no rule', (seed) => {
    const world = { ...createWorld(seed), totalLabel: undefined };
    const month = buildMonth(world, 'A');
    const headers = month.report.columns.map((column) => column.name);
    const keyIndex = headers.indexOf(world.reportKeyHeader);
    const renamed = withReport(month, (matrix) => matrix.map((row, index) => index < 2 ? row.map((cell, at) => at === keyIndex ? `${cell}?` : cell) : row));
    expect(groupCandidates(renamed, { [SOURCE_ID]: month.source }), `seed ${seed}`).toEqual([]);
    if (month.report.rows.length >= 3) {
      const dropped = withReport(month, (matrix) => matrix.slice(1));
      expect(groupCandidates(dropped, { [SOURCE_ID]: month.source }), `seed ${seed}`).toEqual([]);
    }
  });

  it.each(trapSeeds)('seed %i: two source columns holding the same keys are ambiguous and asked about', (seed) => {
    const world = createWorld(seed);
    const month = buildMonth(world, 'A');
    const headers = [...month.source.columns.map((column) => column.name), 'mirror_key'];
    const source = buildTableArtifact({
      id: 'mirrored',
      headers,
      matrix: month.source.rows.map((row) => headers.map((header) => row.values[header === 'mirror_key' ? world.groupColumn : header])),
    });
    const observations = observeTableArtifact('ex-A', month.report);
    const table = tableObservation(observations);
    const { resolved } = learn(observations, { [SOURCE_ID]: source });
    expect(resolved.ambiguousPaths, `seed ${seed}`).toContain(table.path);
    const question = buildClarificationQuestion({ sessionId: 's', candidates: resolved.candidates });
    expect(question?.options.map((option) => option.label).join(' | '), `seed ${seed}`).toContain('mirror_key별 묶음');
    expect(question?.options.map((option) => option.label).join(' | '), `seed ${seed}`).toContain(`${world.groupColumn}별 묶음`);
  });

  it('keeps a one-row table as per-cell numbers and observes a keyed multi-row table whole', () => {
    const single = buildTableArtifact({ id: 's', name: '요약', headers: ['기간', '주문건수', '총매출'], matrix: [['2026-08', 3, 30]] });
    expect(observeTableArtifact('ex', single).map((entry) => [entry.path, entry.value.kind])).toEqual([
      ['field.주문건수', 'number'],
      ['field.총매출', 'number'],
    ]);
    const multi = buildTableArtifact({ id: 'm', name: 'By Region', headers: ['region', 'n'], matrix: [['East', 1], ['West', 2], [null, null]] });
    expect(observeTableArtifact('ex', multi).map((entry) => [entry.path, entry.label, entry.value])).toEqual([
      ['by.region', 'By Region', { kind: 'table', columns: ['region', 'n'], rows: [{ region: 'East', n: 1 }, { region: 'West', n: 2 }] }],
    ]);
    // Without a distinct text column the table is not a keyed report table.
    const repeated = buildTableArtifact({ id: 'r', name: 'r', headers: ['region', 'n'], matrix: [['East', 1], ['East', 2]] });
    expect(observeTableArtifact('ex', repeated).every((entry) => entry.value.kind === 'number')).toBe(true);
  });

  it('learns the order a report lists its groups in, only when one column explains it', () => {
    const source = buildTableArtifact({
      id: 'o', headers: ['team', 'amount'],
      matrix: [['a', 5], ['b', 30], ['c', 12], ['d', 1], ['a', 5], ['c', 3]],
    });
    const learnTable = (matrix: unknown[][]) => {
      const report = buildTableArtifact({ id: 'rep', name: 'rep', headers: ['team', 'total'], matrix });
      const observations = observeTableArtifact('ex-A', report);
      return learn(observations, { o: source }).accepted(observations[0]!.path).map((candidate) => formatMappingLabel(candidate));
    };
    // b 30, c 15, a 10, d 1: largest first.
    expect(learnTable([['b', 30], ['c', 15], ['a', 10], ['d', 1]])).toEqual(['team별 묶음: total=SUM(amount) · 정렬: total 큰 순']);
    // The data's own order needs no sort.
    expect(learnTable([['a', 10], ['b', 30], ['c', 15], ['d', 1]])).toEqual(['team별 묶음: total=SUM(amount)']);
    // An order no single column explains is not invented.
    expect(learnTable([['c', 15], ['a', 10], ['d', 1], ['b', 30]])).toEqual(['team별 묶음: total=SUM(amount)']);
  });

  it('prefers no filter, and a filter that every field shares', () => {
    // Three states, so `state ≠ void` is not the same rows as `state = ok`.
    const source = buildTableArtifact({
      id: 'o',
      headers: ['team', 'state', 'owner', 'amount'],
      matrix: [
        ['a', 'ok', 'k', 10], ['a', 'void', 'p', 5], ['b', 'ok', 'k', 7], ['b', 'hold', 'p', 3],
        ['a', 'ok', 'p', 4], ['b', 'void', 'k', 9], ['a', 'hold', 'k', 1], ['b', 'ok', 'p', 2],
        ['a', 'ok', 'k', 6], ['b', 'ok', 'k', 8],
      ],
    });
    // Kept rows (state ≠ void): 8 rows, amount 41; per team a=21, b=20.
    const summary = buildTableArtifact({ id: 'sum', name: 'sum', headers: ['label', 'n', 'total'], matrix: [['x', 8, 41]] });
    const report = buildTableArtifact({ id: 'rep', name: 'rep', headers: ['team', 'total'], matrix: [['b', 20], ['Σ', 41], ['a', 21]] });
    const observations = [...observeTableArtifact('ex-A', summary), ...observeTableArtifact('ex-A', report)];
    const { accepted } = learn(observations, { o: source });
    const labels = observations.map((entry) => accepted(entry.path).map((candidate) => formatMappingLabel(candidate)));
    expect(labels).toEqual([
      ['COUNT · 조건: state ≠ void'],
      ['SUM(amount) · 조건: state ≠ void'],
      ['team별 묶음: total=SUM(amount) · 조건: state ≠ void · 합계 줄 포함'],
    ]);
    // Unfiltered numbers stay unfiltered.
    const plain = buildTableArtifact({ id: 'p', name: 'p', headers: ['label', 'n'], matrix: [['x', 10]] });
    const plainObservations = observeTableArtifact('ex-A', plain);
    const learned = learn(plainObservations, { o: source }).accepted(plainObservations[0]!.path);
    expect(learned.map((candidate) => candidate.expr)).toEqual([{ op: 'aggregate', input: { op: 'source', sourceId: 'o' }, fn: 'count' }]);
  });
});

describe('table comparison', () => {
  const expected = { kind: 'table' as const, columns: ['k', 'v'], rows: [{ k: 'a', v: 1 }, { k: 'b', v: 2.5 }] };
  const actual = (rows: Array<[unknown, unknown]>, headers = ['v', 'k']): TableArtifact => buildTableArtifact({
    id: 't', headers, matrix: rows.map(([k, v]) => headers.map((header) => (header === 'k' ? k : v))),
  });

  it('matches rows by key in any order and compares every cell', () => {
    expect(compareObservationValue(expected, actual([['b', 2.5], [' a ', 1]]))).toBe(1);
    expect(compareObservationValue(expected, actual([['b', 2.5], ['a', 2]]))).toBe(0);
  });

  it('scores structural differences as zero', () => {
    expect(compareObservationValue(expected, actual([['a', 1]]))).toBe(0);
    expect(compareObservationValue(expected, actual([['a', 1], ['a', 2.5]]))).toBe(0);
    expect(compareObservationValue(expected, actual([['a', 1], ['c', 2.5]]))).toBe(0);
    expect(compareObservationValue(expected, actual([['a', 1], ['b', 2.5]], ['k', 'w']))).toBe(0);
    expect(compareObservationValue(expected, 3)).toBe(0);
    const expr: TransformExpr = { op: 'source', sourceId: 'x' };
    expect(compareObservationValue(expected, expr)).toBe(0);
  });
});
