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

  it('does not report a Webhook connection as healthy when its listener failed', async () => {
    const summary = await summarizeConnection(
      'webhook',
      true,
      { port: 18_789, secretStored: true },
      { webhookTransport: { phase: 'error', error: 'EADDRINUSE' } },
    );

    expect(summary.connected).toBe(false);
    expect(summary.listenerStatus).toBe('error');
    expect(summary.lastError).toBe('EADDRINUSE');
  });
});
