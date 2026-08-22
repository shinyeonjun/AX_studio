import { describe, expect, it } from 'vitest';
import { buildRoleSystemPrompt } from './context-builders.js';

describe('role prompt domain skills', () => {
  it('injects only the domains used by an interview workflow', () => {
    const prompt = buildRoleSystemPrompt('interview', {
      workflow: {
        name: '메일 알림',
        goal: 'Gmail 메일을 Slack에 알림',
        triggerType: 'gmail.new_message',
        gmailAccount: 'primary',
        assumptions: [],
        nodes: [{ type: 'action', id: 'notify', connector: 'slack', action: 'message.send', params: {} }],
      },
      slotValues: {},
      completeness: { slots: [], deployable: false, missingRequired: [], missingConnections: [] },
      connectedConnectors: ['gmail', 'slack', 'document'],
      connectedResources: '',
      sessionHints: '',
      nowIso: '2026-08-21T00:00:00.000Z',
    });

    expect(prompt).toContain('# Gmail');
    expect(prompt).toContain('# Slack');
    expect(prompt).not.toContain('# Document');
    expect(prompt).not.toContain('{{connector_skills}}');
  });

  it('injects read-only capability discovery tools for interview planning', () => {
    const prompt = buildRoleSystemPrompt('interview', {
      workflow: {
        name: 'PDF 알림',
        goal: 'PDF를 Slack과 Gmail로 알림',
        assumptions: [],
        nodes: [],
      },
      slotValues: {},
      completeness: { slots: [], deployable: false, missingRequired: [], missingConnections: [] },
      connectedConnectors: ['gmail', 'slack', 'document'],
      connectedResources: '',
      sessionHints: '',
      nowIso: '2026-08-21T00:00:00.000Z',
    });

    expect(prompt).toContain('capabilities.list');
    expect(prompt).toContain('capabilities.describe');
    expect(prompt).toContain('workflow.inspect');
    expect(prompt).not.toContain('requiredParams=to');
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

  it('does not inject a static catalog for disconnected domains', () => {
    const prompt = buildRoleSystemPrompt('interview', {
      workflow: { name: '알림', goal: 'PDF를 Gmail과 Slack으로 알림', assumptions: [], nodes: [] },
      slotValues: {},
      completeness: { slots: [], deployable: false, missingRequired: [], missingConnections: [] },
      connectedConnectors: ['document'],
      connectedResources: '',
      sessionHints: '',
      nowIso: '2026-08-21T00:00:00.000Z',
    });

    expect(prompt).toContain('capabilities.list');
    expect(prompt).not.toContain('connection=required');
    expect(prompt).not.toContain('requiredParams=to');
  });
});
