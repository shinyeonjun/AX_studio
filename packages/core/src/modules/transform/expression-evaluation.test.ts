import { describe, expect, it, vi } from 'vitest';
import { buildTableArtifact } from '../../contracts/artifacts/table-build.js';
import { buildHttpResponseArtifact } from '../../contracts/artifacts/http-response.js';
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

  it('fails closed when an aggregate receives a truncated table', async () => {
    const connector = new TransformConnector();
    const table = buildTableArtifact({
      id: 'truncated-sales',
      headers: ['amount'],
      matrix: [[1200], [300], [500]],
      rowLimit: 2,
    });

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
        table,
      },
      context(),
    );

    expect(result).toEqual({
      ok: false,
      error: 'incomplete_table_input',
      errorCode: 'incomplete_table_input',
    });

    const contradictory = {
      ...table,
      truncated: true,
      completeness: { status: 'complete' as const, observedCount: 2, hasMore: false },
    };
    await expect(connector.execute(
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
        table: contradictory,
      },
      context(),
    )).resolves.toEqual({
      ok: false,
      error: 'incomplete_table_input',
      errorCode: 'incomplete_table_input',
    });
  });

  it('converts a nested HTTP JSON response only through an explicit rows path', async () => {
    const connector = new TransformConnector();
    const response = buildHttpResponseArtifact({
      executionId: 'exec-transform-http',
      url: 'http://test.local/orders',
      status: 200,
      statusText: 'OK',
      headers: { 'content-type': 'application/json' },
      body: '{"orders":[{"id":"order-1","amount":125000}]}',
      truncated: false,
    });

    await expect(connector.execute('http_to_table', { response }, context())).resolves.toMatchObject({
      ok: false,
      errorCode: 'http_rows_path_required',
    });
    await expect(connector.execute('http_to_table', { response, rowsPath: 'orders' }, context())).resolves.toMatchObject({
      ok: true,
      data: { kind: 'table', rows: [{ values: { id: 'order-1', amount: 125000 } }] },
    });
  });
});
