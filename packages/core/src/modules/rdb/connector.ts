import type { Connector, ConnectorContext, ConnectorResult } from '../types.js';
import { openReadonlySqlite } from '../../store/db.js';

export interface RdbConnectionConfig {
  type: 'postgres' | 'sqlite';
  connectionString?: string;
  filePath?: string;
  allowedSchemas?: string[];
  allowedTables?: string[];
  rowLimit?: number;
}

export class RdbConnector implements Connector {
  name = 'rdb';

  constructor(private config: RdbConnectionConfig) {}

  async execute(action: string, params: Record<string, unknown>, ctx: ConnectorContext): Promise<ConnectorResult> {
    const rowLimit = this.config.rowLimit ?? 1000;

    if (action === 'schema.describe') {
      if (this.config.type === 'sqlite' && this.config.filePath) {
        const db = await openReadonlySqlite(this.config.filePath);
        const tables = db.all("SELECT name FROM sqlite_master WHERE type='table'");
        db.close();
        return { ok: true, data: tables.map((t) => t.name) };
      }
      return { ok: true, data: this.config.allowedTables ?? [] };
    }

    if (action === 'query.read' || action === 'query') {
      const table = (params.table as string) ?? '';
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) {
        return { ok: false, error: 'invalid_table_name', errorCode: 'policy_denied' };
      }
      const allowed = this.config.allowedTables;
      if (!allowed || allowed.length === 0 || !allowed.includes(table)) {
        return { ok: false, error: 'table_not_allowed', errorCode: 'policy_denied' };
      }

      if (this.config.type === 'postgres' && this.config.connectionString) {
        const pg = await import('pg');
        const client = new pg.default.Client({ connectionString: this.config.connectionString });
        await client.connect();
        const sql = `SELECT * FROM ${table} LIMIT ${rowLimit}`;
        const res = await client.query(sql);
        await client.end();
        ctx.variables.queryResult = res.rows;
        return { ok: true, data: res.rows };
      }

      if (this.config.type === 'sqlite' && this.config.filePath) {
        const db = await openReadonlySqlite(this.config.filePath);
        const rows = db.all(`SELECT * FROM ${table} LIMIT ${rowLimit}`);
        db.close();
        ctx.variables.queryResult = rows;
        return { ok: true, data: rows };
      }
    }

    return { ok: false, error: `Unknown or denied rdb action: ${action}` };
  }
}
