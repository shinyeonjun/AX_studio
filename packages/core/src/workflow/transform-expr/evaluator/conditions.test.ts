import { describe, expect, it } from 'vitest';
import { buildTableArtifact } from '../../../contracts/artifacts/table-build.js';
import { evaluateTransformExpr } from '../evaluator.js';

describe('numeric transform conditions', () => {
  it('does not coerce null, blank strings, or booleans into numbers', () => {
    const table = buildTableArtifact({
      id: 'inventory',
      headers: ['stock'],
      matrix: [[20], [null], [''], ['  '], [true], ['10']],
    });
    const result = evaluateTransformExpr({
      op: 'filter',
      input: { op: 'source', sourceId: 'inventory' },
      where: { op: 'lt', left: { ref: 'stock' }, right: { lit: 30 } },
    }, { inventory: table });

    expect(result).toMatchObject({
      rows: [
        { values: { stock: 20 } },
        { values: { stock: 10 } },
      ],
    });
  });
});
