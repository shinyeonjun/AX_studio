import { describe, expect, it } from 'vitest';
import { EMBEDDED_AGENTS_MD, EMBEDDED_AGENT_SOUL } from '../embedded.js';
import { loadAgentsConstitution, loadAgentsSoul } from './artifacts.js';

describe('prompt artifacts', () => {
  it('loads the stable constitution and the separate conversation voice', () => {
    expect(loadAgentsConstitution()).toContain('판단 컨텍스트');
    expect(loadAgentsSoul()).toContain('한국어로 짧고 직접적으로');
  });

  it('uses the embedded copies without the dev opt-in', () => {
    expect(loadAgentsConstitution()).toBe(EMBEDDED_AGENTS_MD.trim());
    expect(loadAgentsSoul()).toBe(EMBEDDED_AGENT_SOUL.trim());
  });
});
