import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { AgentHarness } from '../harness.js';
import type { ModelProvider } from '../model/provider.js';

describe('agent result lifecycle', () => {
  it.each(['cancel', 'timeout'] as const)('rejects a provider ignoring %s instead of returning success', async mode => {
    vi.useFakeTimers();
    try {
      let release!: () => void;
      const provider: ModelProvider = { name: 'mock', async generateText() { return ''; },
        async generateStructured<T>(request: { schema: z.ZodType<T> }) {
          return new Promise(resolve => { release = () => resolve(request.schema.parse({ value: 'late' })); });
        } };
      const harness = new AgentHarness(provider);
      const abort = new AbortController();
      const result = harness.run({ role: 'investigate', outputSchema: z.object({ value: z.string() }),
        context: { taskGoal: 'Read', skillGoal: 'Read', evidence: [], connectedConnectors: [] },
        abortSignal: abort.signal }).catch(error => error);
      if (mode === 'cancel') abort.abort();
      else await vi.advanceTimersByTimeAsync(180_001);
      release();
      expect(await result).toMatchObject({ code: mode === 'cancel' ? 'agent_aborted' : 'agent_timeout' });
      await harness.dispose();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });
});
