import { describe, expect, it } from 'vitest';
import { connectorSkillsForRole } from './skill-routing.js';

describe('connector skill routing', () => {
  it('loads all connected domains for a blank interview', () => {
    const skills = connectorSkillsForRole('interview', {
      workflow: {
        name: '',
        goal: '',
        triggerType: 'manual',
        assumptions: [],
        nodes: [],
      },
      completeness: { slots: [], deployable: false, missingRequired: [], missingConnections: [] },
      connectedConnectors: ['gmail', 'slack', 'unknown'],
      connectedResources: '',
      sessionHints: '',
      nowIso: '2026-08-21T00:00:00.000Z',
    });

    expect(skills).toEqual(['gmail', 'slack']);
  });

  it('narrows interview skills to the workflow domains', () => {
    const skills = connectorSkillsForRole('interview', {
      workflow: {
        name: 'PDF 알림',
        goal: 'PDF를 읽어 Slack으로 알림',
        triggerType: 'local_folder.new_file',
        localFolderId: 'folder-1',
        assumptions: [],
        nodes: [
          { type: 'action', id: 'ingest', connector: 'document', action: 'ingest', params: {} },
          { type: 'action', id: 'notify', connector: 'slack', action: 'message.send', params: {} },
        ],
      },
      completeness: { slots: [], deployable: false, missingRequired: [], missingConnections: [] },
      connectedConnectors: ['gmail', 'slack', 'document', 'local_folder'],
      connectedResources: '',
      sessionHints: '',
      nowIso: '2026-08-21T00:00:00.000Z',
    });

    expect(skills).toEqual(['slack', 'local_folder', 'document']);
    expect(skills).not.toContain('gmail');
  });

  it('routes revise skills from workflow JSON without accepting unknown connectors', () => {
    const skills = connectorSkillsForRole('revise', {
      workflowJson: JSON.stringify({
        trigger: { type: 'gmail.new_message' },
        steps: [{ type: 'action', connector: 'slack', action: 'message.send' }],
        unknown: { connector: 'salesforce' },
      }),
      instruction: '조건을 바꿔줘',
    });

    expect(skills).toEqual(['gmail', 'slack']);
  });
});
