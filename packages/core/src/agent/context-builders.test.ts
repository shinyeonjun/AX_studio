import { describe, expect, it } from 'vitest';
import { buildRoleSystemPrompt } from './context-builders.js';

describe('role prompts', () => {
  it('keeps the command prompt independent of connector skills', () => {
    const prompt = buildRoleSystemPrompt('command', {
      connectedConnectors: ['gmail', 'slack', 'unknown'],
      connectedResources: 'resource.list로 조회',
      nowIso: '2026-08-21T00:00:00.000Z',
    });

    expect(prompt).toContain('AX command protocol');
    expect(prompt).not.toContain('# Gmail');
    expect(prompt).not.toContain('# Slack');
    expect(prompt).not.toContain('tools.list');
  });

  it('uses catalog read capabilities for investigation', () => {
    const prompt = buildRoleSystemPrompt('investigate', {
      skillGoal: '문서 요약',
      taskGoal: '문서 evidence를 요약',
      evidence: [],
      connectedConnectors: ['document'],
    });

    expect(prompt).toContain('document.ingest');
  });
});
