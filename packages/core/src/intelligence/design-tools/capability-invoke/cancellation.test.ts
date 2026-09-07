import { describe, expect, it, vi } from 'vitest';
import type { ConnectorContext, ConnectorResult } from '../../../connectors/types.js';
import { buildDesignToolContext } from '../context.js';
import { invokeReadCapability } from '../capability-invoke.js';

describe('capability read cancellation', () => {
  it('does not execute an already cancelled capability', async () => {
    const controller = new AbortController();
    controller.abort();
    const execute = vi.fn(async () => ({ ok: true, data: {} }));
    const ctx = { ...buildDesignToolContext([], ['http'], { connectors: { http: { name: 'http', execute } } }), abortSignal: controller.signal };
    await expect(invokeReadCapability(ctx, 'http.request', {})).rejects.toThrow();
    expect(execute).not.toHaveBeenCalled();
  });

  it('forwards the signal and rejects a connector result delivered after cancellation', async () => {
    const controller = new AbortController();
    let resolve!: (result: ConnectorResult) => void;
    const execute = vi.fn((_action: string, _params: Record<string, unknown>, _ctx: ConnectorContext) => new Promise<ConnectorResult>((done) => { resolve = done; }));
    const ctx = { ...buildDesignToolContext([], ['http'], { connectors: { http: { name: 'http', execute } } }), abortSignal: controller.signal };
    const pending = invokeReadCapability(ctx, 'http.request', {});
    const rejected = expect(pending).rejects.toThrow();
    controller.abort();
    resolve({ ok: true, data: { body: 'late result' } });
    await rejected;
    expect(execute.mock.calls[0]?.[2]).toMatchObject({ abortSignal: controller.signal });
  });
});
