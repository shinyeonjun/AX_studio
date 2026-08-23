import { describe, expect, it } from 'vitest';
import { buildRoleSystemPrompt } from './context-builders.js';

describe('role prompt domain skills', () => {
  it('keeps command fallback minimal while adding connected domains', () => {
    const prompt = buildRoleSystemPrompt('command', {
      connectedConnectors: ['gmail', 'slack', 'unknown'],
      connectedResources: 'resource.list로 조회',
      nowIso: '2026-08-21T00:00:00.000Z',
    });

    expect(prompt).toContain('AX command protocol');
    expect(prompt).toContain('# Gmail');
    expect(prompt).toContain('# Slack');
    expect(prompt).not.toContain('workflow를 설계하거나 Gmail/Slack을 보내지 않는다');
  });

  it('injects connected read domains for investigation', () => {
    const prompt = buildRoleSystemPrompt('investigate', {
      skillGoal: '문서 요약',
      taskGoal: '문서 evidence를 요약',
      evidence: [],
      connectedConnectors: ['document'],
    });

    expect(prompt).toContain('# Document');
    expect(prompt).toContain('document.ingest');
  });
});
