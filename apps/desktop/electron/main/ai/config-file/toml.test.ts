import { describe, expect, it } from 'vitest';
import { parseAiToml, serializeAiToml } from './toml.js';

describe('ai.toml Jev decision settings', () => {
  it('round-trips non-secret Jev preferences', () => {
    const content = serializeAiToml({
      providers: {},
      secrets: {},
      decision: {
        jev: {
          enabled: true,
          model: 'jev-latest',
          baseURL: 'https://api.typesafe.ai',
          keyOrigin: 'https://api.typesafe.ai',
        },
      },
    });

    expect(content).toContain('[decision.jev]');
    expect(content).toContain('enabled = true');
    expect(content).not.toContain('TYPESAFE_API_KEY');

    expect(parseAiToml(content).decision?.jev).toEqual({
      enabled: true,
      model: 'jev-latest',
      baseURL: 'https://api.typesafe.ai',
      keyOrigin: 'https://api.typesafe.ai',
    });
  });

  it('parses disabled Jev without inventing a secret', () => {
    const parsed = parseAiToml([
      '[decision.jev]',
      'enabled = false',
      'model = "jev-latest"',
      'base_url = "https://typesafe.example"',
      '',
    ].join('\n'));

    expect(parsed.decision?.jev).toEqual({
      enabled: false,
      model: 'jev-latest',
      baseURL: 'https://typesafe.example',
    });
    expect(parsed.secrets).toEqual({});
  });
});

describe('ai.toml string handling', () => {
  it('keeps backslashes, quotes and control characters stable across repeated saves', () => {
    const model = 'C:\\models\\"local"\tv1\nnext';
    let config = parseAiToml(serializeAiToml({ providers: { ollama: { mode: 'api', model } }, secrets: {} }));
    for (let i = 0; i < 3; i += 1) config = parseAiToml(serializeAiToml(config));
    expect(config.providers.ollama?.model).toBe(model);
  });

  it('ignores inline comments after values and section headers', () => {
    const parsed = parseAiToml([
      '[active] # current choice',
      'brand = "gpt" # comment',
      "mode = 'cli'",
      'model = "gpt-5.4#beta" # the # inside quotes is data',
      '[providers.claude]',
      'mode = api # bare value',
    ].join('\n'));
    expect(parsed.active).toEqual({ brand: 'gpt', mode: 'cli', model: 'gpt-5.4#beta' });
    expect(parsed.providers.claude).toEqual({ mode: 'api' });
  });

  it('drops removed Grok/Cursor settings instead of carrying them forward', () => {
    const parsed = parseAiToml([
      '[active]',
      'brand = "grok"',
      'mode = "cli"',
      'model = "grok-4.6"',
      '[providers.grok]',
      'mode = "cli"',
      '[providers.claude]',
      'model = "sonnet"',
    ].join('\n'));
    expect(parsed.active).toBeUndefined();
    expect(parsed.providers).toEqual({ claude: { model: 'sonnet' } });
    expect(serializeAiToml(parsed)).not.toContain('grok');
  });
});
