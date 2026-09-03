/**
 * North Star product QA — cloud models must not receive full untrusted bodies.
 * See docs/qa/north-star-scenarios.md
 */
import { afterEach, describe, expect, it } from 'vitest';
import { createAgentHarness } from '../../agent/harness.js';
import { z } from 'zod';
import { clearDynamicCatalogForTests } from '../../catalog/dynamic-catalog.js';
import { setDocumentEngineClient } from '../../document-engine/engine-client.js';
import { CloudSpyProvider } from './fixtures.js';

describe('North Star QA cloud evidence safety', () => {
  afterEach(() => {
    clearDynamicCatalogForTests();
    setDocumentEngineClient(null);
  });

  it('harness redacts untrusted evidence for cloud backends', async () => {
    const model = new CloudSpyProvider();
    const harness = createAgentHarness(model);
    await harness.run({
      role: 'investigate',
      outputSchema: z.object({ ok: z.boolean() }),
      cloudAllowed: false,
      context: {
        skillGoal: 'g',
        taskGoal: 't',
        evidence: [{ source: 'gmail.messages.read', detail: 'secret-pdf-body' }],
        connectedConnectors: ['gmail'],
        untrustedData: 'secret-pdf-body',
      },
    });
    expect(model.sawSecret).toBe(false);
  });
});
