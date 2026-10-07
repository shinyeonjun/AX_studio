import { describe, expect, it, vi } from 'vitest';
import type { TableArtifact } from '../../../../contracts/artifacts/table.js';
import { labeledTable, mergeColumnLabels, needsColumnLabel } from '../../../../contracts/artifacts/column-labels.js';
import { columnLabelsFor, type ColumnLabelMemory } from './column-labeler.js';
import { tableToMarkdown } from './result/table-display.js';

function table(names: string[]): TableArtifact {
  return {
    id: 't', kind: 'table', sourceId: 's', createdAt: '2026-10-07T00:00:00.000Z',
    columns: names.map((name) => ({ name, type: name === 'amount' ? 'number' : 'string', nullable: true, inferred: false })),
    rows: [{ index: 0, values: Object.fromEntries(names.map((name) => [name, name === 'amount' ? 12000 : 'secret@example.com'])) }],
    truncated: false, completeness: { status: 'complete', hasMore: false },
  } as unknown as TableArtifact;
}

function memory(initial: Record<string, string> = {}): ColumnLabelMemory {
  let saved = { ...initial };
  return { known: () => ({ ...saved }), remember: (labels) => { saved = mergeColumnLabels(saved, labels); } };
}

describe('Korean column headers', () => {
  it('asks once for unseen names, sends no cell values, and remembers the answer', async () => {
    const runText = vi.fn(async () => ({ output: '설명: {"amount":"금액","customer_email":"고객 이메일","bogus":"x"}' }));
    const store = memory({ status: '상태' });
    const labels = await columnLabelsFor(table(['amount', 'customer_email', 'status', '지역']), {
      memory: store, harness: { runText } as never, requestId: 'r1',
    });
    expect(labels).toMatchObject({ amount: '금액', customer_email: '고객 이메일', status: '상태' });
    expect(labels).not.toHaveProperty('bogus');
    const asked = JSON.stringify((runText.mock.calls[0] as unknown[])[0]);
    expect(asked).toContain('customer_email');
    expect(asked).not.toContain('secret@example.com');
    expect(asked).not.toContain('"status"');

    await columnLabelsFor(table(['amount', 'customer_email']), { memory: store, harness: { runText } as never });
    expect(runText).toHaveBeenCalledTimes(1);
  });

  it('keeps the column names when the AI fails, and shows labels without renaming data', async () => {
    const runText = vi.fn(async () => { throw new Error('offline'); });
    expect(await columnLabelsFor(table(['amount']), { memory: memory(), harness: { runText } as never })).toEqual({});
    const shown = labeledTable(table(['amount', 'status']), { amount: '금액' });
    expect(shown.columns.map((column) => column.name)).toEqual(['amount', 'status']);
    expect(tableToMarkdown(shown).split('\n')[0]).toBe('| 금액 | status |');
    expect(needsColumnLabel('지역')).toBe(false);
    expect(needsColumnLabel('orders.amount')).toBe(true);
  });
});
