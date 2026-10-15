import { afterEach, describe, expect, it } from 'vitest';
import type { ZodType } from 'zod';
import { AgentHarness } from '../agent/harness.js';
import type { ModelProvider, StructuredGenerateInput } from '../providers/provider.js';
import { withUsageRecording } from '../usage/recording-decision-engine.js';
import { setUsageRecorder, type StoredUsageCall } from '../usage/usage-recorder.js';
import { LlmDecisionEngine } from './llm-engine.js';

afterEach(() => setUsageRecorder(undefined));

function provider(reply: unknown, seen: Array<StructuredGenerateInput<unknown>>): ModelProvider {
  return {
    name: 'claude-cli',
    model: 'sonnet',
    usageInputExcludesCache: true,
    async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
      seen.push(input as StructuredGenerateInput<unknown>);
      input.onUsage?.({ inputTokens: 5, cachedInputTokens: 600, cacheWriteInputTokens: 100, outputTokens: 20 });
      return (input.schema as ZodType<T>).parse(reply);
    },
    async generateText() { throw new Error('not used'); },
  };
}

describe('the connected AI deciding in Jev\'s place', () => {
  it('sends Jev\'s state and questions and returns answers in Jev\'s shapes', async () => {
    const seen: Array<StructuredGenerateInput<unknown>> = [];
    const harness = new AgentHarness(provider({ route: { choice: 'capability_read', confidence: 0.9 }, ambiguous: { probability: 1.4 } }, seen));
    const engine = new LlmDecisionEngine(harness);
    const result = await engine.evaluate({
      state: { message: '상품 목록 보여줘' },
      questions: {
        route: { type: 'choice', instructions: 'Which route?', criteria: { capability_read: 'read', answer: 'reply' } },
        ambiguous: { type: 'boolean', instructions: 'Is the place ambiguous?' },
      },
    });
    expect(result.answers.route).toEqual({ type: 'choice', choice: 'capability_read', probabilities: { capability_read: 0.9 }, confidence: 0.9 });
    expect(result.answers.ambiguous).toEqual({ type: 'boolean', probability: 1 });
    expect(result.model).toBe('sonnet');
    // Input is counted with the cache, as Claude reports it apart.
    expect(result.usage).toEqual({ inputTokens: 705, outputTokens: 20, cachedInputTokens: 600, cacheWriteInputTokens: 100 });
    expect(JSON.parse(seen[0]!.user!)).toMatchObject({ state: { message: '상품 목록 보여줘' }, questions: { route: { type: 'choice' } } });
    await harness.dispose();
  });

  it('is recorded as an LLM decision on the Usage screen', async () => {
    const recorded: StoredUsageCall[] = [];
    setUsageRecorder((call) => recorded.push(call));
    const harness = new AgentHarness(provider({ yes: { probability: 0.2 } }, []));
    await withUsageRecording(new LlmDecisionEngine(harness)).evaluate({ state: {}, questions: { yes: { type: 'boolean', instructions: 'x' } } });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ engine: 'llm', purpose: 'decision', model: 'sonnet', inputTokens: 705, cachedInputTokens: 600, cacheWriteInputTokens: 100, outputTokens: 20, ok: true });
    await harness.dispose();
  });
});
