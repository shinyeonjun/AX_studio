import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  secrets: new Map<string, string>(),
  probe: vi.fn(),
  summarize: vi.fn(),
  discover: vi.fn(),
}));

vi.mock('../../credential-store.js', () => ({
  getOsSecret: vi.fn(async (name: string) => mocks.secrets.get(name) ?? null),
  setOsSecret: vi.fn(async (name: string, value: string) => { mocks.secrets.set(name, value); }),
  deleteOsSecret: vi.fn(async (name: string) => { mocks.secrets.delete(name); }),
}));

vi.mock('@ax-studio/core', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@ax-studio/core')>();
  return {
    ...actual,
    probeRdbConnection: mocks.probe,
    summarizeRdbSchema: mocks.summarize,
    discoverRdbTables: mocks.discover,
  };
});

import { hydrateRdbConnector } from './hydrate.js';
import { validateAndConnectRdb } from './connect.js';
import { disconnectRdb } from './disconnect.js';
import { discoverRdbTableNames } from './discover.js';
import { resolveRdbConnectionConfig } from './config.js';
import { summarizeRdbConnection } from '../../ipc/connection-state-summary/rdb.js';

type Row = { connector: string; connected: boolean; config?: Record<string, unknown> };

function fakeStore(initial?: Row) {
  let row = initial;
  return {
    row: () => row,
    getConnections: () => (row ? [row] : []),
    setConnection: vi.fn((connector: string, connected: boolean, config?: Record<string, unknown>) => {
      row = { connector, connected, config: config ? JSON.parse(JSON.stringify(config)) as Record<string, unknown> : undefined };
    }),
  };
}

function fakeRuntime() {
  const runtime = { connector: undefined as unknown, setConnector: vi.fn((_name: string, connector: unknown) => { runtime.connector = connector; }) };
  return runtime;
}

function connectorDatabases(runtime: ReturnType<typeof fakeRuntime>): Array<{ id: string; label?: string; type: string }> {
  return ((runtime.connector as { databases?: Array<{ id: string; label?: string; type: string }> } | null)?.databases ?? []);
}

function storedSecrets(): Record<string, { connectionString: string }> {
  return JSON.parse(mocks.secrets.get('rdb.connection-strings') ?? '{}') as Record<string, { connectionString: string }>;
}

const SHOP = 'postgresql://shop:pw@db.example.com:5432/shop';
const HR = 'mysql://hr:pw@hr.example.com:3306/hr';

beforeEach(() => {
  mocks.secrets.clear();
  mocks.probe.mockReset().mockResolvedValue({ ok: true });
  mocks.summarize.mockReset().mockResolvedValue({ tables: [] });
  mocks.discover.mockReset().mockResolvedValue([{ table: 'orders' }]);
});

describe('legacy single-database migration', () => {
  it('turns a flat row and the raw secret into the default database', async () => {
    mocks.secrets.set('rdb.connection-string', SHOP);
    const store = fakeStore({
      connector: 'rdb',
      connected: true,
      config: { type: 'postgres', connectionStringStored: true, allowedTables: ['orders'], label: '쇼핑몰', schema: { tables: [] } },
    });
    const runtime = fakeRuntime();

    await hydrateRdbConnector(store as never, runtime as never);

    expect(store.row()).toMatchObject({
      connected: true,
      config: { databases: [{ id: 'default', type: 'postgres', label: '쇼핑몰', allowedTables: ['orders'] }] },
    });
    expect(storedSecrets()).toEqual({ default: { connectionString: SHOP } });
    expect(mocks.secrets.has('rdb.connection-string')).toBe(false);
    expect(connectorDatabases(runtime).map((database) => database.id)).toEqual(['default']);
    expect(mocks.summarize).not.toHaveBeenCalled();
  });

  it('moves a connection string kept in the row into the secure store', async () => {
    const store = fakeStore({ connector: 'rdb', connected: true, config: { type: 'mysql', connectionString: HR, schema: {} } });

    await hydrateRdbConnector(store as never, fakeRuntime() as never);

    expect(JSON.stringify(store.row()?.config)).not.toContain('pw@');
    expect(store.row()?.config).toMatchObject({ databases: [{ id: 'default', type: 'mysql', connectionStringStored: true }] });
    expect(storedSecrets()).toEqual({ default: { connectionString: HR } });
  });

  it('reads the legacy secret for the default database when resolving work-discovery config', async () => {
    mocks.secrets.set('rdb.connection-string', SHOP);
    await expect(resolveRdbConnectionConfig({ type: 'postgres', connectionStringStored: true }))
      .resolves.toEqual({ databases: [{ id: 'default', type: 'postgres', connectionStringStored: true, connectionString: SHOP }] });
  });

  it('keeps a database whose secret is missing, as not usable rather than erased', async () => {
    const store = fakeStore({ connector: 'rdb', connected: true, config: { databases: [{ id: 'default', type: 'postgres', connectionStringStored: true }] } });
    const runtime = fakeRuntime();

    await hydrateRdbConnector(store as never, runtime as never);

    expect(store.row()).toMatchObject({ connected: false, config: { databases: [{ id: 'default' }] } });
    expect(runtime.connector).toBeNull();
  });
});

describe('several databases', () => {
  it('adds a second database under a new id, named when left blank', async () => {
    const store = fakeStore();
    const runtime = fakeRuntime();

    const first = await validateAndConnectRdb(store as never, runtime as never, { type: 'postgres', connectionString: SHOP, allowedTables: ['orders'], label: '쇼핑몰 DB' });
    const second = await validateAndConnectRdb(store as never, runtime as never, { type: 'mysql', connectionString: HR, allowedTables: ['staff'] });

    expect(first).toEqual({ databaseId: 'default', label: '쇼핑몰 DB' });
    expect(second.databaseId).not.toBe('default');
    expect(second.label).toBe('MySQL hr');
    expect(store.row()?.config).toMatchObject({ databases: [
      { id: 'default', label: '쇼핑몰 DB', type: 'postgres', allowedTables: ['orders'] },
      { id: second.databaseId, label: 'MySQL hr', type: 'mysql', allowedTables: ['staff'] },
    ] });
    expect(JSON.stringify(store.row()?.config)).not.toContain('pw@');
    expect(storedSecrets()).toEqual({ default: { connectionString: SHOP }, [second.databaseId]: { connectionString: HR } });
    expect(connectorDatabases(runtime).map((database) => database.id)).toEqual(['default', second.databaseId]);

    // Connecting the same server again changes that database instead of adding a copy.
    await validateAndConnectRdb(store as never, runtime as never, { type: 'mysql', connectionString: 'mysql://hr:new@hr.example.com:3306/hr', allowedTables: ['staff', 'pay'] });
    expect((store.row()?.config as { databases: unknown[] }).databases).toHaveLength(2);
    expect(storedSecrets()[second.databaseId]).toEqual({ connectionString: 'mysql://hr:new@hr.example.com:3306/hr' });
  });

  it('edits a database by id, reusing its stored address when the field is blank', async () => {
    const store = fakeStore();
    const runtime = fakeRuntime();
    await validateAndConnectRdb(store as never, runtime as never, { type: 'postgres', connectionString: SHOP, allowedTables: ['orders'] });
    const hr = await validateAndConnectRdb(store as never, runtime as never, { type: 'mysql', connectionString: HR, allowedTables: ['staff'], label: '인사 DB' });

    await validateAndConnectRdb(store as never, runtime as never, { databaseId: hr.databaseId, type: 'mysql', connectionString: '', allowedTables: ['pay'], label: '인사 DB' });

    expect(mocks.probe).toHaveBeenLastCalledWith(expect.objectContaining({ connectionString: HR, allowedTables: ['pay'] }));
    expect(store.row()?.config).toMatchObject({ databases: [
      { id: 'default', allowedTables: ['orders'] },
      { id: hr.databaseId, label: '인사 DB', allowedTables: ['pay'] },
    ] });
    expect(storedSecrets()).toEqual({ default: { connectionString: SHOP }, [hr.databaseId]: { connectionString: HR } });
  });

  it('disconnects one database, then all', async () => {
    const store = fakeStore();
    const runtime = fakeRuntime();
    await validateAndConnectRdb(store as never, runtime as never, { type: 'postgres', connectionString: SHOP, allowedTables: ['orders'] });
    const hr = await validateAndConnectRdb(store as never, runtime as never, { type: 'mysql', connectionString: HR, allowedTables: ['staff'] });

    await disconnectRdb(store as never, runtime as never, 'default');
    expect(store.row()).toMatchObject({ connected: true, config: { databases: [{ id: hr.databaseId }] } });
    expect(storedSecrets()).toEqual({ [hr.databaseId]: { connectionString: HR } });
    expect(connectorDatabases(runtime).map((database) => database.id)).toEqual([hr.databaseId]);

    await validateAndConnectRdb(store as never, runtime as never, { type: 'postgres', connectionString: SHOP, allowedTables: ['orders'] });
    await disconnectRdb(store as never, runtime as never);
    expect(store.row()).toEqual({ connector: 'rdb', connected: false, config: undefined });
    expect(mocks.secrets.size).toBe(0);
    expect(runtime.connector).toBeNull();
  });

  it('lists tables with the stored address of the database being edited', async () => {
    mocks.secrets.set('rdb.connection-strings', JSON.stringify({ default: { connectionString: SHOP }, hr: { connectionString: HR } }));

    await discoverRdbTableNames({ type: 'mysql', databaseId: 'hr' });
    expect(mocks.probe).toHaveBeenLastCalledWith({ type: 'mysql', connectionString: HR });
    // Without an id nothing stored is used: a new database needs its address typed.
    await expect(discoverRdbTableNames({ type: 'mysql' })).rejects.toThrow('접속 주소를 먼저 입력');
  });

  it('summarizes every database for the renderer without credentials', async () => {
    mocks.secrets.set('rdb.connection-strings', JSON.stringify({ default: { connectionString: SHOP } }));
    const summary = await summarizeRdbConnection(true, { databases: [
      { id: 'default', label: '쇼핑몰 DB', type: 'postgres', connectionStringStored: true, allowedTables: ['orders'] },
      { id: 'files', label: '재고', type: 'sqlite', filePath: 'C:\\data\\stock.db', allowedTables: ['stock'] },
      { id: 'lost', type: 'mysql', connectionStringStored: true },
    ] });

    expect(JSON.stringify(summary)).not.toContain('pw@');
    expect(summary).toMatchObject({
      connected: true,
      label: '쇼핑몰 DB',
      dbType: 'postgres',
      target: 'db.example.com:5432/shop',
      databases: [
        { id: 'default', label: '쇼핑몰 DB', dbType: 'postgres', target: 'db.example.com:5432/shop', allowedTables: ['orders'] },
        { id: 'files', label: '재고', dbType: 'sqlite', target: 'C:\\data\\stock.db', allowedTables: ['stock'] },
        { id: 'lost', dbType: 'mysql', target: 'MySQL', needsReconnect: true },
      ],
    });
  });
});
