import { describe, expect, it } from 'vitest';
import { AgentHarness } from '../../../harness.js';
import { createDatabaseAsync } from '../../../../../persistence/db.js';
import { WorkflowStore } from '../../../../../persistence/workflow-store.js';
import { runAxCommandChat } from '../../chat.js';
import { AxCommandService } from '../../service.js';
import { scriptedModel } from '../fixtures.js';
import { gmailToSlackRecurringDecisionEngine } from '../jev-recurring-workflow-fixture.js';

describe('runAxCommandChat recurring workflow target selection', () => {
  it('asks for a Slack channel before saving a Jev-selected recurring workflow', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('gmail', true, { email: 'primary' });
    store.setConnection('slack', true);
    const chat = store.saveWorkspaceChat({ messages: [] });
    const service = new AxCommandService(store, {
      readGateway: {
        execute: async () => ({
          tool: 'capabilities.invoke',
          ok: true,
          data: { data: { channels: [{ id: 'C_OPERATIONS', name: '운영' }] } },
        }),
      },
    });
    const presentations: import('../../schema.js').AxUiPresentation[] = [];
    const structuredCalls: unknown[] = [];
    const textCalls: unknown[] = [];
    const decisionEngine = gmailToSlackRecurringDecisionEngine();

    const reply = await runAxCommandChat({
      harness: new AgentHarness(scriptedModel([], structuredCalls, 'test-provider', [], textCalls)),
      commandService: service,
      decisionEngine,
      connectedConnectors: ['gmail', 'slack'],
      readOperationHints: [{
        key: 'op_0', capabilityId: 'gmail.messages.read', connector: 'gmail',
        label: '메일 읽기', description: '메일 본문 읽기', params: {},
      }],
      messages: [],
      workspaceSessionId: chat.id,
      userMessage: '새 Gmail 메일 내용을 요약해서 Slack으로 알려주는 반복 업무를 제안해줘.',
      designToolContext: { connections: [], connectedConnectorIds: ['gmail', 'slack'], connectors: {} },
      onPresentation: (presentation) => presentations.push(presentation),
    });

    expect(reply).toContain('채널을 선택');
    expect(presentations).toHaveLength(1);
    expect(presentations[0]).toMatchObject({
      title: '공유 대상 선택',
      inputs: [{
        id: 'job-action-jev_step_3-slack-channel',
        stepId: 'jev_step_3',
        capabilityId: 'slack.message.send',
        parameterName: 'channel',
        options: [{ value: 'C_OPERATIONS', label: '#운영' }],
      }],
    });
    expect(store.listWorkflows()).toHaveLength(0);
    expect(structuredCalls).toHaveLength(0);
    expect(textCalls).toHaveLength(0);
    db.close();
  });
});
