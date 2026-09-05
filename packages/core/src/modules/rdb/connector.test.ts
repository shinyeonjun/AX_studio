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
        expect(query.data).toMatchObject({
          kind: 'table',
          truncated: false,
          completeness: { status: 'complete', observedCount: 2, hasMore: false },
        });
        expect(query.data.rows).toHaveLength(2);
        expect(query.data.rows[0]).toMatchObject({ values: { priority: 'critical' } });
        expect(queryCtx.variables.queryResult).toEqual(query.data);
      }

      const limited = new RdbConnector({
        type: 'sqlite',
        filePath: fixture.filePath,
        allowedTables: ['customers'],
        rowLimit: 1,
      });
      const limitedResult = await limited.execute('query.read', { table: 'customers' }, connectorContext());
      expect(limitedResult).toMatchObject({
        ok: true,
        data: {
          rows: [{ values: { id: 1, name: 'AsterTech', priority: 'critical' } }],
          truncated: true,
          completeness: { status: 'partial', reason: 'row_limit', observedCount: 1, limit: 1, hasMore: true },
        },
      });

      const denied = await connector.execute('query.read', { table: 'secret_table' }, connectorContext());
      expect(denied).toEqual({ ok: false, error: 'table_not_allowed', errorCode: 'policy_denied' });

      const schemaDenied = await connector.execute('query.read', { table: 'attached.customers' }, connectorContext());
      expect(schemaDenied).toEqual({ ok: false, error: 'table_not_allowed', errorCode: 'policy_denied' });

      const invalid = await connector.execute('query.read', { table: 'bad-name' }, connectorContext());
      expect(invalid).toEqual({ ok: false, error: 'invalid_table_name', errorCode: 'policy_denied' });
    } finally {
      fixture.cleanup();
    }
  });
});
