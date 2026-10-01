import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readRdbRows } from './rows.js';
import { listRdbTables } from './catalog.js';
import { describeRdbTable } from './describe.js';
import type { RdbConnectionConfig } from './types.js';

const state = vi.hoisted(() => ({
  mode: 'success' as 'success' | 'failure' | 'cancel',
  controller: undefined as AbortController | undefined,
  opened: 0, closed: 0, active: 0,
}));

function acquire() {
  state.opened++;
  state.active++;
  let closed = false;
  return () => {
    expect(closed).toBe(false);
    closed = true;
    state.closed++;
    state.active--;
  };
}

function query() {
  if (state.mode === 'failure') throw new Error('synthetic_query_failure');
  return [{ id: 1, name: 'items', table_name: 'items', table_schema: 'public',
    schema_name: 'fixture', column_name: 'id', data_type: 'integer',
    type: 'integer', notnull: 1, pk: 1, hidden: 0, is_nullable: 'NO' }];
}

vi.mock('../../../persistence/db.js', () => ({
  openReadonlySqlite: async () => {
    const close = acquire();
    if (state.mode === 'cancel') state.controller!.abort();
    return { all: query, close };
  },
}));
vi.mock('./drivers.js', () => ({
  openRdbSqlClient: async (_config: unknown, signal?: AbortSignal) => {
    const close = acquire();
    return { close: async () => close(), query: async () => {
      if (state.mode === 'cancel') state.controller!.abort();
      signal?.throwIfAborted();
      return query();
    } };
  },
}));

beforeEach(() => Object.assign(state, { opened: 0, closed: 0, active: 0 }));

describe('RDB operation resource ownership (synthetic adapters)', () => {
  for (const type of ['sqlite', 'postgres', 'mysql'] as const) {
    it.each(['rows', 'catalog', 'describe'] as const)(`${type} closes every acquired adapter after repeated %s success/failure/cancel`, async operation => {
      const config: RdbConnectionConfig = { type, filePath: 'synthetic.sqlite', allowedTables: ['items'] };
      for (let index = 0; index < 90; index++) {
        state.mode = (['success', 'failure', 'cancel'] as const)[index % 3]!;
        state.controller = new AbortController();
        const signal = state.controller.signal;
        const pending = operation === 'rows' ? readRdbRows(config, { table: 'items' }, 5, signal)
          : operation === 'catalog' ? listRdbTables(config, signal)
          : describeRdbTable(config, { table: 'items' }, signal);
        if (state.mode === 'success') await pending;
        else await expect(pending).rejects.toBeInstanceOf(Error);
        expect(state.active).toBe(0);
        expect(state.closed).toBe(index + 1);
      }
      expect(state.opened).toBe(90);
      expect(state.closed).toBe(90);
    });
  }
});
