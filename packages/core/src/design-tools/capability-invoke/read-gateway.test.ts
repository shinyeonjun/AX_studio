import { describe, expect, it, vi } from 'vitest';
import { buildDesignToolContext } from '../context.js';
import { invokeReadCapability } from '../capability-invoke.js';

describe('capability invoke HTTP read gateway', () => {
  it('rejects POST through the generic read capability before connector execution', async () => {
    const execute = vi.fn(async () => ({ ok: true, data: { unexpected: true } }));
    const ctx = buildDesignToolContext([], ['http'], {
      connectors: { http: { name: 'http', execute } },
    });

    await expect(
      invokeReadCapability(ctx, 'http.request', { method: 'POST', path: 'tickets', body: '{}' }),
    ).rejects.toThrow('capability_method_not_allowed');
    expect(execute).not.toHaveBeenCalled();
  });

  it('rejects the explicit POST capability from the read gateway', async () => {
    const execute = vi.fn(async () => ({ ok: true, data: {} }));
    const ctx = buildDesignToolContext([], ['http'], {
      connectors: { http: { name: 'http', execute } },
    });

    await expect(invokeReadCapability(ctx, 'http.post', { path: 'tickets', body: '{}' })).rejects.toThrow(
      'capability_not_readable',
    );
    expect(execute).not.toHaveBeenCalled();
  });
});
