import { describe, expect, it } from 'vitest';
import { DEFAULT_AI_PROVIDER, AiProviderConfigSchema } from './config.js';
import { normalizeAiProviderConfig } from './config-resolve.js';

describe('AI provider config defaults', () => {
  it('keeps the exported default schema-valid and uses it for invalid stored settings', () => {
    expect(AiProviderConfigSchema.parse(DEFAULT_AI_PROVIDER)).toEqual(DEFAULT_AI_PROVIDER);
    expect(normalizeAiProviderConfig(null)).toEqual(DEFAULT_AI_PROVIDER);
  });

  it.each([
    { provider: 'cursor-cli', brand: 'grok', mode: 'cli', model: 'grok-4.6' },
    { provider: 'grok-api', model: 'grok-4.6' },
    { provider: 'cursor', model: 'grok-4.6' },
    { brand: 'grok', mode: 'api' },
  ])('falls back to the default provider for removed Grok/Cursor settings %j', (stored) => {
    expect(normalizeAiProviderConfig(stored)).toEqual(DEFAULT_AI_PROVIDER);
  });

  it('keeps the same default model for OpenAI API and Codex CLI', () => {
    expect(normalizeAiProviderConfig({ brand: 'gpt', mode: 'api' }).model)
      .toBe(normalizeAiProviderConfig({ brand: 'gpt', mode: 'cli' }).model);
  });
});
