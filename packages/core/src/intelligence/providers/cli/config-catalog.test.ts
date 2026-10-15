import { describe, expect, it } from 'vitest';
import { parseCodexModelsOutput } from '../../agent/settings/catalog.js';
import { normalizeAiProviderConfig } from '../../agent/settings/config.js';

describe('normalizeAiProviderConfig', () => {
  it('migrates gpt-cli to codex-cli', () => {
    expect(normalizeAiProviderConfig({ provider: 'gpt-cli', model: 'gpt-4o-mini' })).toEqual({
      provider: 'codex-cli',
      brand: 'gpt',
      model: 'gpt-4o-mini',
    });
  });

  it('moves settings saved in the removed API mode to the brand\'s CLI, with the CLI name for a Claude model', () => {
    expect(normalizeAiProviderConfig({ brand: 'claude', mode: 'api', model: 'claude-opus-5' }))
      .toEqual({ provider: 'claude-cli', brand: 'claude', model: 'opus' });
    expect(normalizeAiProviderConfig({ provider: 'anthropic-api', model: 'claude-sonnet-5-5' }))
      .toEqual({ provider: 'claude-cli', brand: 'claude', model: 'sonnet' });
    expect(normalizeAiProviderConfig({ provider: 'openai-api', model: 'gpt-5.5' }))
      .toEqual({ provider: 'codex-cli', brand: 'gpt', model: 'gpt-5.5' });
  });

  it('keeps a model picked for the CLI as it is', () => {
    expect(normalizeAiProviderConfig({ brand: 'claude', mode: 'cli', model: 'claude-opus-4-8' }))
      .toEqual({ provider: 'claude-cli', brand: 'claude', model: 'claude-opus-4-8' });
  });

  it('falls back to the default for the removed Ollama', () => {
    expect(normalizeAiProviderConfig({ brand: 'ollama', mode: 'api', model: 'llama3.3' }))
      .toEqual(normalizeAiProviderConfig(undefined));
    expect(normalizeAiProviderConfig({ provider: 'ollama-api' })).toEqual(normalizeAiProviderConfig(undefined));
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
