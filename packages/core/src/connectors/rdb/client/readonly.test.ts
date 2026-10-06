import { afterEach, describe, expect, it, vi } from 'vitest';
const clients = vi.hoisted(() => ({
  pgQuery: vi.fn(async (_sql: string, _values?: unknown[]) => ({ rows: [{ value: null }] })),
  pgEnd: vi.fn(async () => undefined),
  mysqlQuery: vi.fn(async (_sql: string) => undefined),
  mysqlExecute: vi.fn(async (_options: unknown, _values?: unknown[]) => [[{ value: '' }], []]),
  mysqlEnd: vi.fn(async () => undefined), mysqlDestroy: vi.fn(),
}));
vi.mock('pg', () => ({ default: { types: { builtins: { DATE: 1082 }, getTypeParser: vi.fn() },
  Client: class { connect = vi.fn(async () => undefined); query = clients.pgQuery; end = clients.pgEnd; on = vi.fn(); } } }));
vi.mock('mysql2', () => ({ createConnection: () => ({
  connect: (done: (error?: Error) => void) => done(), destroy: clients.mysqlDestroy, on: vi.fn(),
  promise: () => ({ query: clients.mysqlQuery, execute: clients.mysqlExecute, end: clients.mysqlEnd }),
}) }));
import { openRdbSqlClient } from './drivers.js';
afterEach(() => vi.clearAllMocks());

describe('network read-only enforcement', () => {
  it('starts PostgreSQL reads in a read-only transaction and rejects write/multiple statements', async () => {
    const client = await openRdbSqlClient({ type: 'postgres', connectionString: 'postgres://synthetic/fixture' });
    expect(clients.pgQuery).toHaveBeenNthCalledWith(1, 'BEGIN READ ONLY');
    expect(await client.query('SELECT value FROM fixture LIMIT $1', [1])).toEqual([{ value: null }]);
    const calls = clients.pgQuery.mock.calls.length;
    await expect(client.query('UPDATE fixture SET value = 1')).rejects.toThrow('rdb_read_only_query_required');
    await expect(client.query('SELECT 1; DELETE FROM fixture')).rejects.toThrow('rdb_read_only_query_required');
    expect(clients.pgQuery).toHaveBeenCalledTimes(calls);
    await client.close();
    expect(clients.pgEnd).toHaveBeenCalledOnce();
  });
  it('starts MySQL reads with session and transaction read-only controls', async () => {
    const client = await openRdbSqlClient({ type: 'mysql', connectionString: 'mysql://synthetic/fixture' });
    expect(clients.mysqlQuery.mock.calls.map(call => call[0])).toEqual(['SET SESSION TRANSACTION READ ONLY', 'START TRANSACTION READ ONLY']);
    expect(await client.query('SELECT value FROM fixture LIMIT ?', [1])).toEqual([{ value: '' }]);
    await expect(client.query('DROP TABLE fixture')).rejects.toThrow('rdb_read_only_query_required');
    expect(clients.mysqlExecute).toHaveBeenCalledOnce();
    await client.close();
  });
  it.each(['postgres', 'mysql'] as const)('fails closed if %s cannot establish read-only access', async type => {
    if (type === 'postgres') clients.pgQuery.mockRejectedValueOnce(new Error('read only unavailable'));
    else clients.mysqlQuery.mockRejectedValueOnce(new Error('read only unavailable'));
    await expect(openRdbSqlClient({ type, connectionString: type + '://synthetic/fixture' })).rejects.toThrow('read only unavailable');
    expect(clients.mysqlExecute).not.toHaveBeenCalled();
    if (type === 'postgres') expect(clients.pgEnd).toHaveBeenCalledOnce();
    else expect(clients.mysqlDestroy).toHaveBeenCalledOnce();
  });
});
