import { describe, expect, it, vi } from 'vitest';
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

describe('TransformConnector expression evaluation', () => {
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
