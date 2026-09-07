import { describe, expect, it, vi } from 'vitest';
import { RdbConnector } from './connector.js';
import { createSqliteCustomersFixture } from './sqlite-test-fixture.js';

function connectorContext(options: { reportCapture?: boolean } = {}) {
  return {
    variables: {} as Record<string, unknown>,
    log: vi.fn(),
    ...options,
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
      const metadata = await connector.execute('table.describe', { table: 'customers' }, ctx);
      expect(metadata).toMatchObject({ ok: true, data: { table: 'customers', columns: [
        { name: 'id', type: 'INTEGER', primaryKeyPosition: 1 },
        { name: 'name', type: 'TEXT', notNullDeclared: true },
        { name: 'priority', type: 'TEXT', notNullDeclared: true },
      ] } });
      expect(JSON.stringify(metadata)).not.toContain('AsterTech');
      expect(await connector.execute('table.describe', { table: 'secret_table' }, ctx))
        .toEqual({ ok: false, error: 'table_not_allowed', errorCode: 'policy_denied' });

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
          offset: 0,
          nextOffset: 1,
          completeness: { status: 'partial', reason: 'row_limit', observedCount: 1, limit: 1, hasMore: true },
        },
      });

      const interactivePage = await limited.execute('query.read', {
        table: 'customers', offset: 1, limit: 100,
      }, connectorContext());
      expect(interactivePage).toMatchObject({ ok: true, data: {
        rows: [{ values: { id: 2 } }], truncated: false, offset: 1,
        completeness: { status: 'complete', hasMore: false },
      } });

      const pagedConnector = new RdbConnector({
        type: 'sqlite',
        filePath: fixture.filePath,
        allowedTables: ['customers'],
        rowLimit: 1,
      });
      const firstPage = await pagedConnector.execute('query.read', {
        table: 'customers', offset: 0, limit: 1,
      }, connectorContext({ reportCapture: true }));
      const secondPage = await pagedConnector.execute('query.read', {
        table: 'customers', offset: 1, limit: 1,
      }, connectorContext({ reportCapture: true }));
      expect(firstPage).toMatchObject({ ok: true, data: {
        rows: [{ values: { id: 1 } }], truncated: true,
        completeness: { status: 'partial', hasMore: true },
      } });

      const unprivileged = await limited.execute('query.read', {
        table: 'customers', offset: 0, limit: 100, reportCapture: true,
      }, connectorContext());
      expect(unprivileged).toMatchObject({ ok: true, data: {
        rows: [{ values: { id: 1 } }], truncated: true,
        completeness: { status: 'partial', reason: 'row_limit', hasMore: true },
      } });
      expect(secondPage).toMatchObject({ ok: true, data: {
        rows: [{ values: { id: 2 } }], truncated: false,
        completeness: { status: 'complete', hasMore: false },
      } });

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
