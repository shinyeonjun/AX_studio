import { describe, expect, it } from 'vitest';
import { parseRowLimitInput, rdbConnectedItemsFor, rdbDatabasesFor, withObjectParticle } from './model';

describe('rdbDatabasesFor', () => {
  it('reads a summary from before several databases as the one default database', () => {
    const state = { connections: [{ connector: 'rdb', connected: true, dbType: 'sqlite' as const, target: 'C:\\shop.db', label: '쇼핑몰' }] };
    expect(rdbDatabasesFor(state)).toEqual([expect.objectContaining({ id: 'default', dbType: 'sqlite', target: 'C:\\shop.db', label: '쇼핑몰' })]);
    expect(rdbDatabasesFor({ connections: [{ connector: 'rdb', connected: false }] })).toEqual([]);
  });

  it('lists every database, marking one that must be connected again', () => {
    const databases = rdbDatabasesFor({ connections: [{ connector: 'rdb', connected: true, databases: [
      { id: 'default', label: '쇼핑몰 DB', dbType: 'postgres', target: 'db:5432/shop', allowedTables: ['orders'] },
      { id: 'x', dbType: 'mysql', target: 'MySQL', needsReconnect: true },
    ] }] });
    expect(rdbConnectedItemsFor(databases)).toEqual([
      { id: 'default', title: '쇼핑몰 DB', subtitle: 'db:5432/shop', meta: 'PostgreSQL · 테이블 1개' },
      { id: 'x', title: 'MySQL', subtitle: 'MySQL', meta: 'MySQL · 다시 연결 필요' },
    ]);
  });
});

describe('withObjectParticle', () => {
  it('follows the last sound of the name', () => {
    expect(withObjectParticle('쇼핑몰 DB')).toBe('"쇼핑몰 DB"를');
    expect(withObjectParticle('매출')).toBe('"매출"을');
    expect(withObjectParticle('PostgreSQL')).toBe('"PostgreSQL"을');
  });
});

describe('parseRowLimitInput', () => {
  it('reads numbers as people type them, and leaves the range to the host', () => {
    expect(parseRowLimitInput('1,000')).toBe(1000);
    expect(parseRowLimitInput(' 500 ')).toBe(500);
    expect(parseRowLimitInput('')).toBeUndefined();
    expect(parseRowLimitInput('많이')).toBeNaN();
  });
});
