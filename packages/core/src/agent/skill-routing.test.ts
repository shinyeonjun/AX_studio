import { describe, expect, it } from 'vitest';
import { connectorSkillsForRole } from './skill-routing.js';

describe('connector skill routing', () => {
  it('loads connected domains for the command protocol', () => {
    const skills = connectorSkillsForRole('command', {
      connectedConnectors: ['gmail', 'slack', 'unknown'],
      connectedResources: '',
      nowIso: '2026-08-21T00:00:00.000Z',
    });

    expect(skills).toEqual(['gmail', 'slack']);
  });

  it('loads only connected domains for investigation', () => {
    const skills = connectorSkillsForRole('investigate', {
      skillGoal: '문서 요약',
      taskGoal: '문서 evidence를 요약',
      evidence: [],
      connectedConnectors: ['slack', 'document'],
    });

    expect(skills).toEqual(['slack', 'document']);
    expect(skills).not.toContain('gmail');
  });
});
