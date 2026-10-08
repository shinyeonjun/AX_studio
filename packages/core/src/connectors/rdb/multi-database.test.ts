import { describe, expect, it, vi } from 'vitest';
import type { ConnectorContext } from '../types.js';
import { RdbConnector } from './connector.js';
import { createSqliteCustomersFixture } from './sqlite-test-fixture.js';
import {
  matchRdbDatabase,
  parseRdbDatabases,
  rdbDatabaseEntries,
  removeRdbDatabase,
  serializeRdbDatabases,
  upsertRdbDatabase,
} from './config/databases.js';
import { buildJevReadOperationHints } from '../../intelligence/decision/read-operation-catalog.js';
import { coveringRdbRead } from '../../intelligence/agent/commands/chat/rdb-read-cover.js';

const ctx = (): ConnectorContext => ({ executionId: 'multi-db', variables: {}, log: vi.fn() });

describe('several databases in one connection', () => {
  it('reads a connection saved before several were possible as the default database', () => {
    const legacy = { type: 'sqlite', filePath: 'D:/a.sqlite', allowedTables: ['orders'], label: '쇼핑몰 DB', schema: { tables: [] } };
    expect(rdbDatabaseEntries(legacy)).toEqual([expect.objectContaining({ id: 'default', label: '쇼핑몰 DB', allowedTables: ['orders'], schema: { tables: [] } })]);
    expect(parseRdbDatabases(legacy)).toEqual([expect.objectContaining({ id: 'default', type: 'sqlite', filePath: 'D:/a.sqlite' })]);
  });

  it('adds, updates and removes databases by id, and never stores a connection string', () => {
    let config: unknown = serializeRdbDatabases(upsertRdbDatabase(undefined, { id: 'default', type: 'sqlite', filePath: 'D:/a.sqlite', label: '쇼핑몰 DB' }));
    config = serializeRdbDatabases(upsertRdbDatabase(config, { id: 'logistics', type: 'postgres', label: '물류 DB', connectionStringStored: true }));
    config = serializeRdbDatabases(upsertRdbDatabase(config, { id: 'default', type: 'sqlite', filePath: 'D:/b.sqlite', label: '쇼핑몰 DB' }));
    expect(rdbDatabaseEntries(config).map((entry) => [entry.id, entry.filePath ?? null])).toEqual([['default', 'D:/b.sqlite'], ['logistics', null]]);
    const withSecret = serializeRdbDatabases([{ id: 'x', type: 'postgres', connectionString: 'postgres://u:p@h/db' } as never]);
    expect(JSON.stringify(withSecret)).not.toContain('postgres://');
    expect(removeRdbDatabase(config, 'logistics').map((entry) => entry.id)).toEqual(['default']);
    // A postgres entry without its merged secret cannot be opened.
    expect(parseRdbDatabases(config).map((entry) => entry.id)).toEqual(['default']);
  });

  it('matches a named database by id or label, and needs a name when there are several', () => {
    const databases = [{ id: 'a', label: '쇼핑몰 DB' }, { id: 'b', label: '물류 DB' }];
    expect(matchRdbDatabase(databases, 'b')?.id).toBe('b');
    expect(matchRdbDatabase(databases, '물류 db')?.id).toBe('b');
    expect(matchRdbDatabase(databases)).toBeUndefined();
    expect(matchRdbDatabase([...databases, { id: 'default' }])?.id).toBe('default');
    expect(matchRdbDatabase([databases[0]!])?.id).toBe('a');
  });

  it('reads from the database the read names', async () => {
    const shop = await createSqliteCustomersFixture();
    const other = await createSqliteCustomersFixture();
    try {
      const connector = new RdbConnector([
        { id: 'shop', label: '쇼핑몰 DB', type: 'sqlite', filePath: shop.filePath, allowedTables: ['customers'] },
        { id: 'crm', label: 'CRM DB', type: 'sqlite', filePath: other.filePath, allowedTables: [] },
      ]);
      const read = await connector.execute('query.read', { connectionId: 'shop', table: 'customers' }, ctx());
      expect(read).toMatchObject({ ok: true, data: { source: { connectionLabel: '쇼핑몰 DB', table: 'customers' } } });
      // The CRM database does not allow that table: the name decides the policy too.
      expect(await connector.execute('query.read', { connectionId: 'crm', table: 'customers' }, ctx()))
        .toMatchObject({ ok: false, error: 'table_not_allowed' });
      expect(await connector.execute('query.read', { table: 'customers' }, ctx()))
        .toMatchObject({ ok: false, error: 'rdb_connection_required' });
      expect(await connector.execute('schema.describe', { connectionId: 'nope' }, ctx()))
        .toMatchObject({ ok: false, error: 'rdb_connection_not_found' });
    } finally {
      shop.cleanup();
      other.cleanup();
    }
  });

  it('offers each database’s tables to Jev, pinned to that database, and never joins across them', () => {
    const schema = (tables: string[]) => ({ tables: tables.map((table) => ({ table, columns: ['id', 'customer_id'] })), relations: [
      { from: { table: 'orders', column: 'customer_id' }, to: { table: 'customers', column: 'id' }, declared: true }] });
    const hints = buildJevReadOperationHints([{
      connector: 'rdb', connected: true, config: { databases: [
        { id: 'shop', label: '쇼핑몰 DB', type: 'sqlite', filePath: 'a', allowedTables: ['orders', 'customers'], schema: schema(['orders', 'customers']) },
        { id: 'logistics', label: '물류 DB', type: 'sqlite', filePath: 'b', allowedTables: ['orders'], schema: schema(['orders']) },
      ] },
    }] as never, '주문');
    const reads = hints.filter((hint) => hint.capabilityId === 'rdb.query.read');
    expect(reads.map((hint) => [hint.sourceLabel, hint.params.connectionId, hint.params.table])).toEqual(expect.arrayContaining([
      ['쇼핑몰 DB', 'shop', 'orders'], ['물류 DB', 'logistics', 'orders'],
    ]));
    expect(reads.find((hint) => hint.params.connectionId === 'logistics')?.description).toContain('물류 DB의');
    const shopOrders = reads.find((hint) => hint.params.connectionId === 'shop' && hint.params.table === 'orders' && !hint.params.join)!;
    const logisticsOrders = reads.find((hint) => hint.params.connectionId === 'logistics')!;
    expect(coveringRdbRead([shopOrders, logisticsOrders], hints)).toBeUndefined();
  });
});
