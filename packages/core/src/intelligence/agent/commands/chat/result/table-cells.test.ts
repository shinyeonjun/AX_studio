import { describe, expect, it } from 'vitest';
import type { TableArtifact } from '../../../../../contracts/artifacts/table.js';
import { tableToMarkdown } from './table-display.js';

function table(values: Record<string, unknown>): TableArtifact {
  return {
    id: 't', kind: 'table', sourceId: 's', createdAt: '2026-10-09T00:00:00.000Z',
    columns: Object.keys(values).map((name) => ({ name, type: 'string', nullable: true, inferred: false })),
    rows: [{ index: 0, values }], truncated: false, completeness: { status: 'complete', hasMore: false },
  } as unknown as TableArtifact;
}

describe('table cells in the chat', () => {
  it('writes a list of plain values as words, and keeps nested values as written', () => {
    const lines = tableToMarkdown(table({ tags: ['beauty', 'mascara'], sizes: [1200, 3], meta: [{ a: 1 }] })).split('\n');
    expect(lines[2]).toBe('| beauty, mascara | 1200, 3 | [{"a":1}] |');
  });
});
