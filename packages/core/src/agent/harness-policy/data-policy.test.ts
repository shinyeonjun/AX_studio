import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { createAgentHarness } from '../harness.js';
import { CloudSpyProvider } from './fixtures.js';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('harness dataPolicy', () => {
  it('redacts untrusted data for cloud backends when cloudAllowed is false', async () => {
    const model = new CloudSpyProvider();
    const harness = createAgentHarness(model);
    await harness.run({
      role: 'investigate',
      outputSchema: z.object({ ok: z.boolean() }),
      cloudAllowed: false,
      context: {
        skillGoal: 'g', taskGoal: 't',
        evidence: [{ source: 'gmail.messages.read', detail: 'secret-evidence' }],
        connectedConnectors: ['gmail'], untrustedData: 'secret-email-body',
      },
    });
    expect(model.lastUntrusted).toBe('absent');
    expect(model.lastSystem).not.toContain('secret-evidence');
  });

  it('redacts image bytes for cloud backends when cloudAllowed is false', async () => {
    const model = new CloudSpyProvider();
    await createAgentHarness(model).run({
      role: 'investigate', outputSchema: z.object({ ok: z.boolean() }), cloudAllowed: false,
      images: [{ data: new Uint8Array([1, 2, 3]), mimeType: 'image/png' }],
      context: { skillGoal: 'g', taskGoal: 't', evidence: [], connectedConnectors: [] },
    });
    expect(model.lastImages).toBeUndefined();
  });
});
