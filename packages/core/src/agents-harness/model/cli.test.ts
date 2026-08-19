import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { parseCodexModelsOutput } from '../settings/catalog.js';
import { parseStructuredOutput, zodToJsonSchema } from './cli-json.js';
import { normalizeAiProviderConfig } from '../settings/config.js';

describe('normalizeAiProviderConfig', () => {
  it('migrates gpt-cli to codex-cli', () => {
    expect(normalizeAiProviderConfig({ provider: 'gpt-cli', model: 'gpt-4o-mini' })).toEqual({
      provider: 'codex-cli',
      brand: 'gpt',
      mode: 'cli',
      model: 'gpt-4o-mini',
    });
  });

  it('drops ollama api settings', () => {
    expect(normalizeAiProviderConfig({ provider: 'ollama', baseURL: 'http://localhost:11434/v1' }).provider).toBe(
      'claude-cli',
    );
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

describe('cli json', () => {
  it('parses fenced json and claude wrapper', () => {
    const schema = z.object({ category: z.string() });
    expect(parseStructuredOutput('```json\n{"category":"critical"}\n```', schema)).toEqual({ category: 'critical' });
    expect(
      parseStructuredOutput(JSON.stringify({ structured_output: { category: 'ok' } }), schema),
    ).toEqual({ category: 'ok' });
  });

  it('converts object schema', () => {
    const schema = z.object({
      name: z.string(),
      flag: z.boolean().default(false),
    });
    const json = zodToJsonSchema(schema);
    expect(json.type).toBe('object');
    expect((json.required as string[]).includes('name')).toBe(true);
    expect((json.required as string[]).includes('flag')).toBe(false);
  });
});
