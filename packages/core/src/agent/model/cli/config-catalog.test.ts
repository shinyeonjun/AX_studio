import { describe, expect, it } from 'vitest';
import { parseCodexModelsOutput } from '../../settings/catalog.js';
import { normalizeAiProviderConfig } from '../../settings/config.js';

describe('normalizeAiProviderConfig', () => {
  it('migrates gpt-cli to codex-cli', () => {
    expect(normalizeAiProviderConfig({ provider: 'gpt-cli', model: 'gpt-4o-mini' })).toEqual({
      provider: 'codex-cli',
      brand: 'gpt',
      mode: 'cli',
      model: 'gpt-4o-mini',
    });
  });

  it('resolves Ollama API settings to the local OpenAI-compatible provider', () => {
    expect(normalizeAiProviderConfig({ brand: 'ollama', mode: 'api' })).toEqual({
      provider: 'ollama-api',
      brand: 'ollama',
      mode: 'api',
      model: 'llama3.3',
    });
  });
});

describe('parseCodexModelsOutput', () => {
  it('reads json model list', () => {
    const models = parseCodexModelsOutput(JSON.stringify({ models: [{ id: 'gpt-5.4', name: 'GPT 5.4' }] }));
    expect(models[0]).toEqual({ id: 'gpt-5.4', label: 'gpt-5.4' });
  });

  it('reads text lines', () => {
    const models = parseCodexModelsOutput('gpt-5.4-mini\no3\nnot-a-model');
    expect(models.map((m) => m.id)).toEqual(['gpt-5.4-mini', 'o3']);
  });
});
