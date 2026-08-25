import { describe, expect, it } from 'vitest';
import { buildCommandProtocolPrompt } from './command-protocol.js';
import { buildInvestigatePrompt } from './investigate-prompt.js';

describe('role prompts', () => {
  it('keeps the command protocol independent of connector skills', () => {
    const prompt = buildCommandProtocolPrompt({
      connectedConnectors: ['gmail', 'slack', 'unknown'],
      commands: [{ name: 'workflow.list' }],
      outputInstructions: 'reply or command',
    });

    expect(prompt).toContain('AX command protocol');
    expect(prompt).not.toContain('# Gmail');
    expect(prompt).not.toContain('# Slack');
    expect(prompt).not.toContain('tools.list');
  });

  it('uses catalog read capabilities for investigation', () => {
    const prompt = buildInvestigatePrompt('investigate', {
      skillGoal: '문서 요약',
      taskGoal: '문서 evidence를 요약',
      evidence: [],
      connectedConnectors: ['document'],
    });

    expect(prompt).toContain('document.ingest');
  });
});
