import { describe, expect, it, vi } from 'vitest';
import { RdbConnector } from './connector.js';
import { createSqliteCustomersFixture } from './sqlite-test-fixture.js';

function connectorContext() {
  return {
    variables: {} as Record<string, unknown>,
    log: vi.fn(),
  };
}

describe('RdbConnector sqlite', () => {
  it('describes tables, reads allowlisted rows, and rejects unknown tables', async () => {
    const fixture = await createSqliteCustomersFixture();
    try {
      const connector = new RdbConnector({
        type: 'sqlite',
        filePath: fixture.filePath,
        allowedTables: ['customers'],
        rowLimit: 10,
      });
      const ctx = connectorContext();
      const schema = await connector.execute('schema.describe', {}, ctx);
      expect(schema.ok).toBe(true);
      if (schema.ok) expect(schema.data).toEqual(['customers']);

      const queryCtx = connectorContext();
      const query = await connector.execute('query.read', { table: 'customers' }, queryCtx);
      expect(query.ok).toBe(true);
      if (query.ok) {
        expect(query.data).toHaveLength(2);
        expect(query.data[0]).toMatchObject({ priority: 'critical' });
        expect(queryCtx.variables.queryResult).toEqual(query.data);
      }

      const denied = await connector.execute('query.read', { table: 'secret_table' }, connectorContext());
      expect(denied).toEqual({ ok: false, error: 'table_not_allowed', errorCode: 'policy_denied' });

      const invalid = await connector.execute('query.read', { table: 'bad-name' }, connectorContext());
      expect(invalid).toEqual({ ok: false, error: 'invalid_table_name', errorCode: 'policy_denied' });
    } finally {
      fixture.cleanup();
    }
  });
});
