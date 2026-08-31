import { describe, expect, it, vi } from 'vitest';
import { buildTableArtifact } from '../../contracts/artifacts/table-build.js';
import type { ConnectorContext } from '../types.js';
import { TransformConnector } from './connector.js';

function context(): ConnectorContext {
  return {
    executionId: 'exec-transform',
    variables: {},
    connections: {},
    log: vi.fn(),
  };
}

describe('TransformConnector', () => {
  it('converts a TableArtifact to tab-separated text in declared column order', async () => {
    const connector = new TransformConnector();
    const ctx = context();
    const table = buildTableArtifact({
      id: 'table-sales',
      headers: ['product', 'amount'],
      matrix: [
        ['A', 1200],
        ['B', null],
      ],
    });

    const result = await connector.execute('table_to_text', { table }, ctx);

    expect(result).toEqual({
      ok: true,
      data: { text: 'product\tamount\nA\t1200\nB\t', kind: 'TextArtifact' },
    });
    expect(ctx.variables.transformText).toBe('product\tamount\nA\t1200\nB\t');
  });

  it('preserves array input compatibility', async () => {
    const connector = new TransformConnector();

    const result = await connector.execute(
      'table_to_text',
      { table: [{ product: 'A', amount: 1200 }] },
      context(),
    );

    expect(result).toMatchObject({
      ok: true,
      data: { text: 'product\tamount\nA\t1200' },
    });
  });

  it('evaluates raw RDB rows through the table artifact boundary', async () => {
    const connector = new TransformConnector();

    const result = await connector.execute(
      'evaluate',
      {
        expr: {
          op: 'aggregate',
          input: { op: 'source', sourceId: 'rdb:sales' },
          fn: 'sum',
          column: 'amount',
        },
        discoverySourceId: 'rdb:sales',
        outputPath: 'field.total',
        table: [{ amount: 1200 }, { amount: 300 }],
      },
      context(),
    );

    expect(result).toMatchObject({
      ok: true,
      data: { value: 1500, outputPath: 'field.total' },
    });
  });

  it('evaluates expressions across multiple raw source tables', async () => {
    const connector = new TransformConnector();

    const result = await connector.execute(
      'evaluate',
      {
        expr: {
          op: 'ratio',
          numerator: {
            op: 'aggregate',
            input: { op: 'source', sourceId: 'rdb:sales' },
            fn: 'sum',
            column: 'amount',
          },
          denominator: {
            op: 'aggregate',
            input: { op: 'source', sourceId: 'rdb:targets' },
            fn: 'sum',
            column: 'amount',
          },
          multiplyBy: 100,
        },
        discoverySourceId: 'rdb:sales',
        outputPath: 'field.achievement',
        table: [{ amount: 50 }],
        tables: { 'rdb:targets': [{ amount: 100 }] },
      },
      context(),
    );

    expect(result).toMatchObject({
      ok: true,
      data: { value: 50, outputPath: 'field.achievement' },
    });
  });
});
