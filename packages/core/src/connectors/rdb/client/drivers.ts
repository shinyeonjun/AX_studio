import { Socket } from 'node:net';
import type { RdbConnectionConfig } from '../connector.js';
import type { RdbRow, RdbSqlClient } from './types.js';

function withAbort<T>(signal: AbortSignal | undefined, run: () => Promise<T>, cancel: () => void): Promise<T> {
  signal?.throwIfAborted();
  if (!signal) return run();
  return new Promise<T>((resolve, reject) => {
    const abort = () => {
      cancel();
      reject(signal.reason ?? new DOMException('Operation aborted', 'AbortError'));
    };
    signal.addEventListener('abort', abort, { once: true });
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return run();
    }).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

export async function openRdbSqlClient(config: RdbConnectionConfig, abortSignal?: AbortSignal): Promise<RdbSqlClient> {
  abortSignal?.throwIfAborted();
  if (config.type === 'postgres' && config.connectionString) {
    const pg = await import('pg');
    abortSignal?.throwIfAborted();
    const types = {
      getTypeParser(oid: number, format?: 'text' | 'binary') {
        if (oid === pg.default.types.builtins.DATE && format !== 'binary') {
          return (value: string) => value;
        }
        return pg.default.types.getTypeParser(oid, format);
      },
    };
    const client = new pg.default.Client({ connectionString: config.connectionString, types,
      ...(abortSignal ? { stream: () => new Socket({ signal: abortSignal }) } : {}),
      connectionTimeoutMillis: 10_000, statement_timeout: 30_000, query_timeout: 30_000 });
    let closing: Promise<void> | undefined;
    const close = () => closing ??= client.end();
    const cancel = () => { void close().catch(() => undefined); };
    try {
      await withAbort(abortSignal, () => client.connect(), cancel);
    } catch (error) {
      await close().catch(() => undefined);
      throw error;
    }
    return {
      query: async (sql, values = []) => {
        const result = await withAbort(abortSignal, () => client.query(sql, values), cancel);
        return result.rows as RdbRow[];
      },
      close,
    };
  }

  if (config.type === 'mysql' && config.connectionString) {
    const mysql = await import('mysql2');
    abortSignal?.throwIfAborted();
    const raw = mysql.createConnection(config.connectionString);
    const connection = raw.promise();
    let destroyed = false;
    const cancel = () => { destroyed = true; raw.destroy(); };
    try {
      await withAbort(abortSignal, () => new Promise<void>((resolve, reject) => {
        raw.connect(error => error ? reject(error) : resolve());
      }), cancel);
    } catch (error) {
      cancel();
      throw error;
    }
    return {
      query: async (sql, values = []) => {
        const [rows] = await withAbort(abortSignal,
          () => connection.execute({ sql, timeout: 30_000 }, values), cancel);
        return (Array.isArray(rows) ? rows : []) as RdbRow[];
      },
      close: async () => {
        if (!destroyed) await connection.end();
      },
    };
  }

  throw new Error('invalid_rdb_config');
}
