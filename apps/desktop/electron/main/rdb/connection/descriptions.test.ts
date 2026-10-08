import { describe, expect, it, vi } from 'vitest';
import { rdbDatabaseEntries, type WorkflowStore } from '@ax-studio/core';
import { fillRdbTableDescriptions } from './descriptions.js';

function memoryStore(config: Record<string, unknown>) {
  let row = { connector: 'rdb', connected: true, config };
  return {
    getConnections: () => [row],
    setConnection: (connector: string, connected: boolean, next: Record<string, unknown>) => { row = { connector, connected, config: next }; },
    row: () => row,
  } as unknown as WorkflowStore & { row: () => typeof row };
}

describe('Korean table descriptions after connecting', () => {
  it('describes each database’s allowed tables once and saves them with that database', async () => {
    const store = memoryStore({ databases: [
      { id: 'default', label: 'ERP DB', type: 'sqlite', filePath: 'a', allowedTables: ['tb_ord_mst'],
        schema: { tables: [{ table: 'tb_ord_mst', columns: ['ord_no'] }, { table: 'secret', columns: [] }] } },
      { id: 'hr', label: '인사 DB', type: 'sqlite', filePath: 'b', allowedTables: ['emp'],
        schema: { tables: [{ table: 'emp', columns: ['nm'] }] }, tableDescriptions: { emp: '직원 명부' } },
    ] });
    const runText = vi.fn(async () => ({ output: '{"tb_ord_mst":"주문 원장"}' }));
    await fillRdbTableDescriptions(store, { runText } as never);
    expect(runText).toHaveBeenCalledOnce();
    expect(JSON.stringify((runText.mock.calls[0] as unknown[])[0])).not.toContain('secret');
    const entries = rdbDatabaseEntries((store as unknown as { row: () => { config: unknown } }).row().config);
    expect(entries.map((entry) => entry.tableDescriptions)).toEqual([{ tb_ord_mst: '주문 원장' }, { emp: '직원 명부' }]);
  });

  it('changes nothing without an AI', async () => {
    const config = { databases: [{ id: 'default', type: 'sqlite', filePath: 'a', allowedTables: ['t'], schema: { tables: [{ table: 't', columns: [] }] } }] };
    const store = memoryStore(config);
    await fillRdbTableDescriptions(store, { runText: vi.fn(async () => { throw new Error('no ai'); }) } as never);
    expect((store as unknown as { row: () => { config: unknown } }).row().config).toBe(config);
  });
});
