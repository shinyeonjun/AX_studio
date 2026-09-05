import { describe, expect, it } from 'vitest';
import { buildTableArtifact } from './table-build.js';

describe('table completeness', () => {
  it('records whether a table contains all source rows', () => {
    const complete = buildTableArtifact({
      id: 'tbl_complete',
      headers: ['amount'],
      matrix: [[10], [20]],
      rowLimit: 2,
    });
    const partial = buildTableArtifact({
      id: 'tbl_partial',
      headers: ['amount'],
      matrix: [[10], [20], [30]],
      rowLimit: 2,
    });

    expect(complete.completeness).toEqual({
      status: 'complete',
      observedCount: 2,
      hasMore: false,
    });
    expect(partial.completeness).toEqual({
      status: 'partial',
      reason: 'row_limit',
      observedCount: 2,
      limit: 2,
      hasMore: true,
    });
  });
});
