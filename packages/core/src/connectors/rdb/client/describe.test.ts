import { beforeEach, describe, expect, it, vi } from 'vitest';
import { describeRdbTable } from './describe.js';
import { openRdbSqlClient } from './drivers.js';

vi.mock('./drivers.js', () => ({ openRdbSqlClient: vi.fn() }));
describe('physical SQL metadata', () => {
  beforeEach(() => vi.resetAllMocks());
  it.each(['postgres', 'mysql'] as const)('uses parameterized allowlisted %s metadata and closes the client', async type => {
    const query = vi.fn(async () => [{ column_name: 'measure', data_type: 'decimal', is_nullable: 'YES' }]);
    const close = vi.fn(async () => {});
    vi.mocked(openRdbSqlClient).mockResolvedValue({ query, close });
    await expect(describeRdbTable({ type, allowedSchemas: ['warehouse'], allowedTables: ['metrics'] },
      { schema: 'warehouse', table: 'metrics' })).resolves.toEqual([{ name: 'measure', type: 'decimal', nullable: true }]);
    expect(query).toHaveBeenCalledWith(expect.stringContaining('information_schema.columns'), ['warehouse', 'metrics']);
    expect(close).toHaveBeenCalledTimes(1);
  });
  it('denies access before opening the driver', async () => {
    await expect(describeRdbTable({ type: 'postgres', allowedTables: ['metrics'] }, { table: 'private' }))
      .rejects.toThrow('table_not_allowed');
    expect(openRdbSqlClient).not.toHaveBeenCalled();
  });

  it('returns bounded database-provided column descriptions when available', async () => {
    const query = vi.fn(async () => [{
      column_name: 'amount',
      data_type: 'numeric',
      is_nullable: 'NO',
      description: '결제 금액 '.repeat(200),
    }]);
    const close = vi.fn(async () => {});
    vi.mocked(openRdbSqlClient).mockResolvedValue({ query, close });

    const columns = await describeRdbTable(
      { type: 'postgres', allowedTables: ['orders'] },
      { table: 'orders' },
    );
    expect(columns).toEqual([{
      name: 'amount',
      type: 'numeric',
      nullable: false,
      description: '결제 금액 '.repeat(200).trim().slice(0, 500),
    }]);
  });
  it('closes on query failure and rejects oversized metadata without truncating', async () => {
    const query = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(Array(201).fill({}));
    const close = vi.fn(async () => {});
    vi.mocked(openRdbSqlClient).mockResolvedValue({ query, close });
    const config = { type: 'postgres' as const, allowedTables: ['metrics'] };
    await expect(describeRdbTable(config, { table: 'metrics' })).rejects.toThrow('offline');
    await expect(describeRdbTable(config, { table: 'metrics' })).rejects.toThrow('rdb_metadata_limit');
    expect(close).toHaveBeenCalledTimes(2);
  });
});
