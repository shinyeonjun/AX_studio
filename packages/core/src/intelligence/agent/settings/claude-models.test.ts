import { describe, expect, it } from 'vitest';
import { normalizeModelOptions } from './model-options.js';
import { CLAUDE_CLI_MODELS, resolveClaudeCliModelId } from './providers/claude/meta.js';

describe('claude cli models', () => {
  it('exposes exactly eight picker models', () => {
    expect(normalizeModelOptions(CLAUDE_CLI_MODELS)).toHaveLength(8);
    expect(CLAUDE_CLI_MODELS.map((model) => model.label)).toEqual([
      'Fable 5',
      'Opus 5',
      'Sonnet 5',
      'Haiku 4.5',
      'Opus 4.8',
      'Opus 4.7',
      'Opus 4.6',
      'Sonnet 4.6',
    ]);
  });

  it('maps saved settings ids back to the fixed picker', () => {
    expect(resolveClaudeCliModelId('claude-fable-5[1m]')).toBe('fable');
    expect(resolveClaudeCliModelId('claude-opus-4-6')).toBe('claude-opus-4-6');
    expect(resolveClaudeCliModelId('unknown-model')).toBe('sonnet');
  });
});
