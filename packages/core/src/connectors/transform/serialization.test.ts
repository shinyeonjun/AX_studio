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

describe('TransformConnector table serialization', () => {
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
});
