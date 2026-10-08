import { describe, expect, it } from 'vitest';
import { executeTransformAction } from '../../../../../connectors/transform/connector/execute.js';
import type { TableArtifact } from '../../../../../contracts/artifacts/table.js';
import type { TransformExpr } from '../../../../../workflow/transform-expr/dsl.js';
import { evaluateTransformExpr } from '../../../../../workflow/transform-expr/evaluator.js';
import { mulberry32 } from '../../../../../workflow/schedule/testing/random.js';
import { recurringJobFromReadRecipe } from '../../job-registration/from-execution.js';
import type { AxCommand, AxCommandResult } from '../../schema.js';
import { CHAT_READ_SOURCE_ID, chatReadRecipe, thenTransform } from './read-recipe.js';
import { tableForJevTransform } from './index.js';

const SEEDS = Array.from({ length: 30 }, (_, index) => 7 + index * 104_729);
const ARRAY_KEYS = ['products', 'items', 'data', 'results', '상품'];
const TEXT_FIELDS = ['title', 'name', 'category', 'brand', '상태'];
const NUMBER_FIELDS = ['stock', 'price', 'rating', 'qty', '재고'];

function pick<T>(random: () => number, items: readonly T[]): T {
  return items[Math.floor(random() * items.length)]!;
}

/** A provider response whose shape (array key, fields, values) changes with the seed. */
function world(seed: number) {
  const random = mulberry32(seed);
  const arrayKey = pick(random, ARRAY_KEYS);
  const text = pick(random, TEXT_FIELDS);
  const number = pick(random, NUMBER_FIELDS);
  const extra = pick(random, NUMBER_FIELDS.filter((field) => field !== number));
  const categories = ['A', 'B', 'C', '가', '나'].slice(0, 2 + Math.floor(random() * 3));
  const rows = Array.from({ length: 5 + Math.floor(random() * 25) }, (_, index) => ({
    id: index + 1,
    [text]: pick(random, categories),
    [number]: Math.floor(random() * 100),
    [extra]: Math.round(random() * 1000) / 10,
  }));
  const body = JSON.stringify({ [arrayKey]: rows, total: rows.length + 100, skip: 0, limit: rows.length });
  const select = random() < 0.4 ? [text, number] : undefined;
  const path = `items${select ? `?select=${select.join(',')}` : ''}`;
  const threshold = Math.floor(random() * 100);
  const filter: TransformExpr = random() < 0.5
    ? { op: 'filter', input: { op: 'source', sourceId: CHAT_READ_SOURCE_ID }, where: { op: pick(random, ['lt', 'gte', 'gt', 'lte'] as const), left: { ref: number }, right: { lit: threshold } } }
    : { op: 'filter', input: { op: 'source', sourceId: CHAT_READ_SOURCE_ID }, where: { op: 'eq', left: { ref: text }, right: { lit: categories[0]! } } };
  let expression: TransformExpr = filter;
  if (random() < 0.6) expression = { op: 'sort', input: expression, by: [{ column: number, direction: pick(random, ['asc', 'desc'] as const) }] };
  if (random() < 0.4) expression = { op: 'limit', input: expression, count: 1 + Math.floor(random() * 5) };
  if (random() < 0.5) expression = { op: 'select', input: expression, columns: [text, number] };
  const command: AxCommand = { name: 'capability.invoke', args: { id: 'http.request', params: { connectionId: 'shop', method: 'GET', path } } } as AxCommand;
  const result: AxCommandResult = {
    command: 'capability.invoke',
    status: 'ok',
    data: {
      id: 'resp', kind: 'http_response', status: 200, statusText: 'OK', headers: {}, body,
      url: `https://shop.example/${path}`, truncated: false, completeness: { status: 'complete' },
    },
  } as AxCommandResult;
  return { command, result, expression, number };
}

/** The table the chat showed: the read converted the chat way, then the chat's shaping. */
function chatTable(command: AxCommand, result: AxCommandResult, expression: TransformExpr): TableArtifact {
  const read = tableForJevTransform(command, result)!;
  return evaluateTransformExpr(expression, { [CHAT_READ_SOURCE_ID]: read }) as TableArtifact;
}

/** The table a saved job builds from the same response with the recipe's own steps. */
async function jobTable(args: Record<string, unknown>, response: unknown): Promise<TableArtifact> {
  const steps = args.steps as Array<{ id: string; action: string; params: Record<string, unknown> }>;
  const ctx = { variables: {}, log: () => {} } as never;
  const toTable = steps.find((step) => step.id === 'to_table')!;
  const converted = await executeTransformAction('http_to_table', { ...toTable.params, response }, ctx);
  expect(converted.ok).toBe(true);
  const shape = steps.find((step) => step.id === 'shape');
  if (!shape) return converted.data as TableArtifact;
  const shaped = await executeTransformAction('evaluate', { ...shape.params, table: converted.data }, ctx);
  expect(shaped.ok).toBe(true);
  return (shaped.data as { value: TableArtifact }).value;
}

const rowsOf = (table: TableArtifact) => table.rows.map((row) => row.values);

describe('a read answer repeated as a job', () => {
  it.each(SEEDS)('seed %i: the job builds exactly the table the chat showed', async (seed) => {
    const { command, result, expression } = world(seed);
    const recipe = chatReadRecipe(command, result, expression);
    expect(recipe, `seed ${seed}`).toBeDefined();
    const conversion = recurringJobFromReadRecipe({ recipe, request: '재고 적은 상품 표', scheduleValue: monthly });
    if (!conversion.ok) throw new Error(conversion.message);
    const shown = chatTable(command, result, expression);
    const built = await jobTable(conversion.args, (result.data as unknown));
    expect(built.columns.map((column) => column.name), `seed ${seed}`).toEqual(shown.columns.map((column) => column.name));
    expect(rowsOf(built), `seed ${seed}`).toEqual(rowsOf(shown));
  });

  it('repeats a reshaped earlier answer as both shapings in order', async () => {
    const { command, result, expression, number } = world(SEEDS[0]!);
    const first = chatReadRecipe(command, result, expression)!;
    const second: TransformExpr = { op: 'sort', input: { op: 'source', sourceId: CHAT_READ_SOURCE_ID }, by: [{ column: number, direction: 'desc' }] };
    const recipe = thenTransform(first, second);
    const conversion = recurringJobFromReadRecipe({ recipe, request: '정렬', scheduleValue: monthly });
    if (!conversion.ok) throw new Error(conversion.message);
    const shown = evaluateTransformExpr(second, { [CHAT_READ_SOURCE_ID]: chatTable(command, result, expression) }) as TableArtifact;
    expect(rowsOf(await jobTable(conversion.args, result.data))).toEqual(rowsOf(shown));
  });

  it('offers no recipe for writes or non-HTTP reads', () => {
    const { result } = world(SEEDS[1]!);
    expect(chatReadRecipe({ name: 'capability.invoke', args: { id: 'http.request', params: { method: 'POST', path: 'x' } } } as AxCommand, result)).toBeUndefined();
    expect(chatReadRecipe({ name: 'capability.invoke', args: { id: 'rdb.query', params: {} } } as AxCommand, result)).toBeUndefined();
  });

  it('repeats a database read with the calculation the answer showed', () => {
    const expression: TransformExpr = {
      op: 'totals',
      input: { op: 'filter', input: { op: 'source', sourceId: CHAT_READ_SOURCE_ID }, where: { op: 'eq', left: { ref: 'status' }, right: { lit: '완료' } } },
      aggregates: [{ as: 'amount 합계', fn: 'sum', column: 'amount' }],
    };
    const command = { name: 'capability.invoke', args: { id: 'rdb.query.read', params: { table: 'orders' } } } as AxCommand;
    const recipe = chatReadRecipe(command, { status: 'ok', command: 'capability.invoke', data: {} } as AxCommandResult, expression);
    expect(recipe).toEqual({ kind: 'rdb_table', params: { table: 'orders' }, expression });
    const conversion = recurringJobFromReadRecipe({ recipe, request: '완료 주문 매출 합계', scheduleValue: monthly });
    if (!conversion.ok) throw new Error(conversion.message);
    expect(conversion.args.steps).toEqual([
      { type: 'action', id: 'fetch', connector: 'rdb', action: 'query.read', params: { table: 'orders' } },
      {
        type: 'action', id: 'shape', connector: 'transform', action: 'evaluate',
        params: { expr: expression, discoverySourceId: CHAT_READ_SOURCE_ID, outputPath: 'result' },
        bindings: { table: { from: 'fetch', output: 'rows' } },
      },
    ]);
  });

  it('explains when the recipe is gone (e.g. after a restart)', () => {
    expect(recurringJobFromReadRecipe({ recipe: undefined, request: 'x', scheduleValue: monthly }).ok).toBe(false);
  });
});

const monthly = (await import('../../../../../workflow/schedule/input-value.js')).encodeScheduleInputValue({
  kind: 'recurrence', freq: 'monthly', interval: 1, byMonthDay: [1], times: [{ hour: 9, minute: 0 }], anchor: '2026-10-01', timezone: 'Asia/Seoul',
});
