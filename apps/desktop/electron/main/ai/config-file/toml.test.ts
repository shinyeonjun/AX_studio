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
