import { describe, expect, it } from 'vitest';
import { loadAgentsConstitution, loadAgentsSoul } from './artifacts.js';

describe('prompt artifacts', () => {
  it('loads the stable constitution and the separate conversation voice', () => {
    expect(loadAgentsConstitution()).toContain('판단 컨텍스트');
    expect(loadAgentsSoul()).toContain('한국어로 짧고 직접적으로');
  });
});
