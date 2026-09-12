import { describe, expect, it } from 'vitest';
import { reportConnectionIdentity } from './checkpoint-identity.js';

describe('report checkpoint source identity', () => {
  const connection = { connector: 'http', connected: true,
    config: { baseUrl: 'https://source.test', headers: { authorization: 'private-token' }, connectedAt: 'old' } };
  it('ignores volatile health metadata and unrelated connectors, but not changed credentials or targets', () => {
    const original = reportConnectionIdentity([connection]);
    expect(JSON.stringify(original)).not.toContain('private-token');
    expect(reportConnectionIdentity([{ ...connection, config: { ...connection.config, connectedAt: 'new', lastError: 'offline' } },
      { connector: 'slack', connected: true }])).toEqual(original);
    for (const config of [{ ...connection.config, baseUrl: 'https://other.test' },
      { ...connection.config, headers: { authorization: 'changed' } }]) {
      expect(reportConnectionIdentity([{ ...connection, config }])).not.toEqual(original);
    }
    expect(reportConnectionIdentity([{ ...connection, connected: false }])).not.toEqual(original);
  });
  it('is invariant to connector and object-key ordering', () => {
    const rdb = { connector: 'rdb', connected: true, config: { database: 'reports', password: 'private-password' } };
    expect(reportConnectionIdentity([connection, rdb])).toEqual(reportConnectionIdentity([
      { ...rdb, config: { password: 'private-password', database: 'reports' } }, connection,
    ]));
  });
});
