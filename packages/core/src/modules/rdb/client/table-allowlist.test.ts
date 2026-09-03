import { describe, expect, it } from 'vitest';
import { isAllowedRdbTable } from '../client.js';
import type { RdbConnectionConfig } from '../connector.js';
const baseConfig = (overrides: Partial<RdbConnectionConfig> = {}): RdbConnectionConfig => ({ type: 'postgres', connectionString: 'postgresql://example', ...overrides });
describe('rdb table allowlists', () => {
  it('enforces table allowlists', () => {
    const config = baseConfig({ allowedTables: ['public.customers', 'orders'] });
    expect(isAllowedRdbTable(config, { schema: 'public', table: 'customers' })).toBe(true);
    expect(isAllowedRdbTable(config, { table: 'orders' })).toBe(true);
    expect(isAllowedRdbTable(config, { table: 'secret' })).toBe(false);
    expect(isAllowedRdbTable(baseConfig({ allowedTables: [] }), { table: 'customers' })).toBe(false);
    expect(isAllowedRdbTable(baseConfig(), { table: 'customers' })).toBe(false);
  });
  it('enforces schema allowlists before allowing a table', () => {
    const config = baseConfig({ allowedSchemas: ['public'], allowedTables: ['customers'] });
    expect(isAllowedRdbTable(config, { schema: 'public', table: 'customers' })).toBe(true);
    expect(isAllowedRdbTable(config, { schema: 'private', table: 'customers' })).toBe(false);
    expect(isAllowedRdbTable(config, { table: 'customers' })).toBe(false);
    expect(isAllowedRdbTable({ type: 'sqlite', filePath: '/tmp/app.db', allowedTables: ['customers'] }, { schema: 'attached', table: 'customers' })).toBe(false);
  });
});
