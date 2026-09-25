import { describe, expect, it } from 'vitest';
import { DEFAULT_AI_PROVIDER, AiProviderConfigSchema } from './config.js';
import { normalizeAiProviderConfig } from './config-resolve.js';

describe('AI provider config defaults', () => {
  it('keeps the exported default schema-valid and uses it for invalid stored settings', () => {
    expect(AiProviderConfigSchema.parse(DEFAULT_AI_PROVIDER)).toEqual(DEFAULT_AI_PROVIDER);
    expect(normalizeAiProviderConfig(null)).toEqual(DEFAULT_AI_PROVIDER);
  });
});
