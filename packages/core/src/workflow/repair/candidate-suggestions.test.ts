import { describe, expect, it } from 'vitest';
import type { TableArtifact } from '../../contracts/artifacts/table.js';
import { suggestRepairCandidates } from '../repair.js';
import { actualTable, contract, sourceId, stepId } from './fixtures.js';

describe('conservative workflow repair', () => {
  it('suggests a bounded column candidate without copying row values', () => {
    const candidates = suggestRepairCandidates(contract, stepId, actualTable);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]).toMatchObject({
      op: 'rename_column',
      sourceId,
      stepId,
      from: 'customer_count',
      to: 'customers',
      expectedType: 'number',
      actualType: 'integer',
    });
    expect(JSON.stringify(candidates)).not.toContain('"customers":42');
  });

  it('does not invent a rename for an incompatible type change', () => {
    const changedType: TableArtifact = {
      ...actualTable,
      columns: actualTable.columns.map((column) =>
        column.name === 'customers' ? { ...column, type: 'date' as const } : column,
      ),
    };

    expect(suggestRepairCandidates(contract, stepId, changedType)).toEqual([]);
  });
});
