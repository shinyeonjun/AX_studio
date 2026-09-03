import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createAgentHarness } from '../harness.js';
import { CloudSpyProvider } from './fixtures.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('harness cancellation', () => {
  it('does not invoke the provider when the request is already aborted', async () => {
    const model = new CloudSpyProvider();
    const controller = new AbortController();
    controller.abort();

    await expect(createAgentHarness(model).run({
      role: 'investigate', outputSchema: z.object({ ok: z.boolean() }),
      context: { skillGoal: 'g', taskGoal: 't', evidence: [], connectedConnectors: [] },
      abortSignal: controller.signal,
    })).rejects.toMatchObject({ code: 'agent_aborted' });
    expect(model.structuredCalls).toBe(0);
  });

  it('cleans up cancellation resources when vision validation rejects the request', async () => {
    const model = new CloudSpyProvider();
    const controller = new AbortController();
    const removeEventListener = vi.spyOn(controller.signal, 'removeEventListener');
    const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');

    await expect(createAgentHarness(model).run({
      role: 'investigate', outputSchema: z.object({ ok: z.boolean() }),
      context: { skillGoal: 'g', taskGoal: 't', evidence: [], connectedConnectors: [] },
      images: [{ data: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }],
      abortSignal: controller.signal,
    })).rejects.toMatchObject({ code: 'vision_unavailable' });

    expect(model.structuredCalls).toBe(0);
    expect(clearTimeoutSpy).toHaveBeenCalledOnce();
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
