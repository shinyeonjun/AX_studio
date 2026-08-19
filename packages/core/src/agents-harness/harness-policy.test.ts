import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createAgentHarness } from './harness.js';
import type { ModelProvider, StructuredGenerateInput, TextGenerateInput } from './model/provider.js';

class CloudSpyProvider implements ModelProvider {
  readonly name = 'cursor-cli';
  lastUntrusted?: string;

  async generateStructured<T>(input: StructuredGenerateInput<T>): Promise<T> {
    this.lastUntrusted = input.system.includes('[UNTRUSTED DATA]') ? 'present' : 'absent';
    return input.schema.parse({ ok: true });
  }

  async generateText(input: TextGenerateInput): Promise<string> {
    return input.user ?? '';
  }
}

describe('harness dataPolicy', () => {
  it('redacts untrusted data for cloud backends when cloudAllowed is false', async () => {
    const model = new CloudSpyProvider();
    const harness = createAgentHarness(model);
    await harness.run({
      role: 'investigate',
      outputSchema: z.object({ ok: z.boolean() }),
      cloudAllowed: false,
      context: {
        skillGoal: 'g',
        taskGoal: 't',
        evidence: [],
        untrustedData: 'secret-email-body',
      },
    });
    expect(model.lastUntrusted).toBe('absent');
  });
});
