import { describe, expect, it, vi } from 'vitest';

const storedSecret = vi.hoisted(() => vi.fn(async () => 'postgresql://user:secret@localhost:5432/ax'));

vi.mock('../credential-store.js', () => ({
  getOsSecret: storedSecret,
}));

import { summarizeConnection } from './connection-state-summary.js';

describe('renderer-facing connection summaries', () => {
  it('does not return remote RDB credentials to the renderer', async () => {
    const summary = await summarizeConnection('rdb', true, {
      type: 'postgres',
      connectionStringStored: true,
      allowedSchemas: ['public'],
      allowedTables: ['reports'],
      rowLimit: 100,
    });

    expect(summary).not.toHaveProperty('connectionString');
    expect(JSON.stringify(summary)).not.toContain('secret');
    expect(summary.target).toBe('localhost:5432/ax');
  });
});
