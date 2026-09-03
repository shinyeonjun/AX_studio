import type { RdbConnectionConfig } from '../connector.js';
import type { RdbRow, RdbSqlClient } from './types.js';

export async function openRdbSqlClient(config: RdbConnectionConfig): Promise<RdbSqlClient> {
  if (config.type === 'postgres' && config.connectionString) {
    const pg = await import('pg');
    const types = {
      getTypeParser(oid: number, format?: 'text' | 'binary') {
        if (oid === pg.default.types.builtins.DATE && format !== 'binary') {
          return (value: string) => value;
        }
        return pg.default.types.getTypeParser(oid, format);
      },
    };
    const client = new pg.default.Client({ connectionString: config.connectionString, types });
    try {
      await client.connect();
    } catch (error) {
      await client.end().catch(() => undefined);
      throw error;
    }
    return {
      query: async (sql, values = []) => {
        const result = await client.query(sql, values);
        return result.rows as RdbRow[];
      },
      close: async () => {
        await client.end();
      },
    };
  }

  if (config.type === 'mysql' && config.connectionString) {
    const mysql = await import('mysql2/promise');
    const connection = await mysql.createConnection(config.connectionString);
    return {
      query: async (sql, values = []) => {
        const [rows] = await connection.execute(sql, values);
        return (Array.isArray(rows) ? rows : []) as RdbRow[];
      },
      close: async () => {
        await connection.end();
      },
    };
  }

  throw new Error('invalid_rdb_config');
}
