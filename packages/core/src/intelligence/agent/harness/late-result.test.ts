import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { appendAppLog } from '../../../persistence/paths/app-log.js';
import { AgentHarness } from '../harness.js';
import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from '../model/provider.js';

const appLog = vi.hoisted(() => ({ appendAppLog: vi.fn() }));
vi.mock('../../../persistence/paths/app-log.js', () => appLog);

describe('agent result lifecycle', () => {
  it.each(['cancel', 'timeout'] as const)('rejects a provider ignoring %s instead of returning success', async mode => {
    vi.useFakeTimers();
    try {
      appLog.appendAppLog.mockClear();
      let release!: () => void;
      const provider: ModelProvider = { name: 'mock', async generateText() { return ''; },
        async generateStructured<T>(request: { schema: z.ZodType<T>; onUsage?: (usage: { inputTokens: number }) => void }) {
          return new Promise(resolve => { release = () => {
            request.onUsage?.({ inputTokens: 5 });
            resolve(request.schema.parse({ value: 'late' }));
          }; });
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
      expect(appLog.appendAppLog).toHaveBeenCalledWith(
        mode === 'cancel' ? 'info' : 'error',
        mode === 'cancel' ? 'Agent invocation cancelled' : 'Agent timed out after 180000ms',
        expect.objectContaining({
          providerUsageAvailable: true,
          usage: { inputTokens: 5 },
          durationMs: expect.any(Number),
        }),
      );
      await harness.dispose();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('logs known usage when structured output parsing fails after the provider response', async () => {
    appLog.appendAppLog.mockClear();
    const provider: ModelProvider = {
      name: 'mock',
      async generateStructured<T>(request: StructuredGenerateInput<T>): Promise<T> {
        request.onUsage?.({ inputTokens: 12, outputTokens: 4, totalTokens: 16 });
        throw Object.assign(new Error('invalid_output'), { code: 'model_output_invalid' });
      },
      async generateText(): Promise<string> { return ''; },
    };
    const harness = new AgentHarness(provider);
    const result = await harness.run({
      role: 'investigate',
      outputSchema: z.object({ value: z.string() }),
      context: { skillGoal: 'test', taskGoal: 'test', evidence: [], connectedConnectors: [] },
    }).catch(error => error);

    expect(result).toMatchObject({ code: 'model_output_invalid' });
    expect(appLog.appendAppLog).toHaveBeenCalledWith('error', 'Agent invocation failed', expect.objectContaining({
      providerUsageAvailable: true,
      usage: { inputTokens: 12, outputTokens: 4, totalTokens: 16 },
      errorCode: 'model_output_invalid',
    }));
    await harness.dispose();
  });

  it('logs known usage when text generation fails after the provider response', async () => {
    appLog.appendAppLog.mockClear();
    const provider: ModelProvider = {
      name: 'mock',
      async generateStructured<T>(): Promise<T> { throw new Error('structured_generation_not_used'); },
      async generateText(request: TextGenerateInput): Promise<string> {
        request.onUsage?.({ inputTokens: 7, outputTokens: 2, totalTokens: 9 });
        throw Object.assign(new Error('provider_error'), { code: 'provider_failed' });
      },
    };
    const harness = new AgentHarness(provider);
    const result = await harness.runText({
      role: 'command',
      context: { connectedConnectors: [], connectedResources: 'none', nowIso: 'now' },
      user: 'test',
    }).catch(error => error);

    expect(result).toMatchObject({ code: 'provider_failed' });
    expect(appLog.appendAppLog).toHaveBeenCalledWith('error', 'Agent text invocation failed', expect.objectContaining({
      providerUsageAvailable: true,
      usage: { inputTokens: 7, outputTokens: 2, totalTokens: 9 },
      errorCode: 'provider_failed',
    }));
    await harness.dispose();
  });
});
