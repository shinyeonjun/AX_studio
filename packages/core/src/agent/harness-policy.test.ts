import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createAgentHarness } from './harness.js';
import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from './model/provider.js';

class CloudSpyProvider implements ModelProvider {
  readonly name = 'cursor-cli';
  structuredCalls = 0;
  lastUntrusted?: string;
  lastSystem = '';
  lastImages?: StructuredGenerateInput<unknown>['images'];

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    this.structuredCalls += 1;
    this.lastSystem = input.system;
    this.lastUntrusted = input.system.includes('[UNTRUSTED DATA]') ? 'present' : 'absent';
    this.lastImages = input.images;
    return input.schema.parse({ ok: true });
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    return input.user ?? '';
  }
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('harness dataPolicy', () => {
  it('redacts untrusted data for cloud backends when cloudAllowed is false', async () => {
    const model = new CloudSpyProvider();
    const harness = createAgentHarness(model);
    await harness.run({
      role: 'investigate',
      outputSchema: z.object({ ok: z.boolean() }),
      cloudAllowed: false,
      context: {
        skillGoal: 'g',
        taskGoal: 't',
        evidence: [{ source: 'gmail.messages.read', detail: 'secret-evidence' }],
        connectedConnectors: ['gmail'],
        untrustedData: 'secret-email-body',
      },
    });
    expect(model.lastUntrusted).toBe('absent');
    expect(model.lastSystem).not.toContain('secret-evidence');
  });

  it('redacts image bytes for cloud backends when cloudAllowed is false', async () => {
    const model = new CloudSpyProvider();
    await createAgentHarness(model).run({
      role: 'investigate',
      outputSchema: z.object({ ok: z.boolean() }),
      cloudAllowed: false,
      images: [{ data: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }],
      context: {
        skillGoal: 'g',
        taskGoal: 't',
        evidence: [],
        connectedConnectors: [],
      },
    });
    expect(model.lastImages).toBeUndefined();
  });
});

describe('harness cancellation', () => {
  it('does not invoke the provider when the request is already aborted', async () => {
    const model = new CloudSpyProvider();
    const controller = new AbortController();
    controller.abort();

    await expect(createAgentHarness(model).run({
      role: 'investigate',
      outputSchema: z.object({ ok: z.boolean() }),
      context: {
        skillGoal: 'g',
        taskGoal: 't',
        evidence: [],
        connectedConnectors: [],
      },
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
      role: 'investigate',
      outputSchema: z.object({ ok: z.boolean() }),
      context: {
        skillGoal: 'g',
        taskGoal: 't',
        evidence: [],
        connectedConnectors: [],
      },
      images: [{ data: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }],
      abortSignal: controller.signal,
    })).rejects.toMatchObject({ code: 'vision_unavailable' });

    expect(model.structuredCalls).toBe(0);
    expect(clearTimeoutSpy).toHaveBeenCalledOnce();
    expect(removeEventListener).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
