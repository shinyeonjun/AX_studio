import { describe, expect, it, vi } from 'vitest';
import { reportModelTokenUsage } from './provider.js';

describe('provider token usage', () => {
  it('reports only finite nonnegative integer fields and tolerates observer failures', () => {
    const onUsage = vi.fn();
    reportModelTokenUsage({ onUsage }, {
      inputTokens: 11,
      outputTokens: undefined,
      totalTokens: 15,
      cachedInputTokens: -1,
      reasoningTokens: Number.NaN,
    });
    expect(onUsage).toHaveBeenCalledWith({ inputTokens: 11, totalTokens: 15 });

    expect(() => reportModelTokenUsage({ onUsage: () => { throw new Error('observer_failed'); } }, {
      inputTokens: 1,
    })).not.toThrow();
  });
});
