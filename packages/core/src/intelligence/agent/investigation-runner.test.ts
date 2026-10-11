import { describe, expect, it } from 'vitest';
import { createInvestigationRunner, type AgentHarness } from './harness.js';

function runnerFor(providerName: string) {
  return createInvestigationRunner({ providerName } as unknown as AgentHarness);
}

describe('createInvestigationRunner', () => {
  it('reports whether the provider sends data off this machine', () => {
    expect(runnerFor('mock').isCloud).toBe(false);
    expect(runnerFor('anthropic-api').isCloud).toBe(true);
  });

  it('follows the harness provider name instead of a copy taken at creation', () => {
    const harness = { providerName: 'mock' } as { providerName: string };
    const runner = createInvestigationRunner(harness as unknown as AgentHarness);
    harness.providerName = 'anthropic-api';
    expect(runner.providerName).toBe('anthropic-api');
    expect(runner.isCloud).toBe(true);
  });
});
