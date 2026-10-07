import { afterEach, describe, expect, it } from 'vitest';
import { createSqliteCustomersFixture } from '../sqlite-test-fixture.js';
import { discoverRdbTables, listRdbTables } from './catalog.js';

describe('which tables a connection shows', () => {
  let cleanup: (() => void) | undefined;
  afterEach(() => cleanup?.());

  it('shows every table to the person picking, and only the picked ones afterwards', async () => {
    const fixture = await createSqliteCustomersFixture();
    cleanup = fixture.cleanup;
    const config = { type: 'sqlite' as const, filePath: fixture.filePath };
    expect(await discoverRdbTables(config)).toEqual([{ table: 'customers' }, { table: 'secret_table' }]);
    expect(await listRdbTables(config)).toEqual([]);
    expect(await listRdbTables({ ...config, allowedTables: ['customers'] })).toEqual([{ table: 'customers' }]);
  });
});
