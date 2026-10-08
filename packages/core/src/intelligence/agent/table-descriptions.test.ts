import { describe, expect, it, vi } from 'vitest';
import { describeTables } from './table-descriptions.js';
import { buildJevReadOperationHints } from '../decision/read-operation-catalog.js';

describe('Korean descriptions of database tables', () => {
  it('asks once from table and column names, keeps known ones, and ignores malformed answers', async () => {
    const runText = vi.fn(async () => ({ output: '{"tb_ord_mst":"주문 원장 · 주문별 금액·상태","tb_x":"' + 'x'.repeat(200) + '"}' }));
    const result = await describeTables({
      harness: { runText } as never, database: 'ERP DB',
      tables: [{ table: 'tb_ord_mst', columns: ['ord_no', 'amt'] }, { table: 'tb_x', columns: [] }, { table: 'tb_cust_mst', columns: ['cust_nm'] }],
      known: { tb_cust_mst: '거래처 원장' },
    });
    expect(result).toEqual({ tb_cust_mst: '거래처 원장', tb_ord_mst: '주문 원장 · 주문별 금액·상태' });
    const asked = JSON.stringify((runText.mock.calls[0] as unknown[])[0]);
    expect(asked).toContain('tb_ord_mst');
    expect(asked).not.toContain('tb_cust_mst');
  });

  it('keeps what was known when the AI is unavailable', async () => {
    const runText = vi.fn(async () => { throw new Error('no ai'); });
    expect(await describeTables({ harness: { runText } as never, database: 'DB', tables: [{ table: 'a', columns: [] }], known: { b: '설명' } }))
      .toEqual({ b: '설명' });
  });

  it('shows the description beside the table name in what Jev chooses from', () => {
    const hints = buildJevReadOperationHints([{ connector: 'rdb', connected: true, config: {
      type: 'sqlite', filePath: 'a', allowedTables: ['tb_ord_mst'], tableDescriptions: { tb_ord_mst: '주문 원장' },
    } }] as never, '주문');
    const read = hints.find((hint) => hint.capabilityId === 'rdb.query.read')!;
    expect(read.label).toBe('DB 조회: tb_ord_mst (주문 원장)');
    expect(read.description).toContain('(주문 원장)');
    expect(read.params).toEqual({ table: 'tb_ord_mst' });
  });
});
