import { describe, expect, it } from 'vitest';
import { AgentHarness } from '../../harness.js';
import type { StructuredGenerateInput } from '../../model/provider.js';
import { createDatabaseAsync } from '../../../../persistence/db.js';
import { WorkflowStore } from '../../../../persistence/workflow-store.js';
import { runAxCommandChat } from '../chat.js';
import { AxCommandService } from '../service.js';
import { JOB_COMMIT_CONFIRM_VALUE } from '../job-registration.js';
import { scriptedModel } from './fixtures.js';
import { gmailToSlackRecurringDecisionEngine } from './jev-recurring-workflow-fixture.js';

describe('runAxCommandChat recurring job registration', () => {
  it('registers a recurring job with one propose command and host-commits without another model loop', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('gmail', true, { email: 'primary' });
    store.setConnection('slack', true);
    const chat = store.saveWorkspaceChat({ messages: [] });
    const ran: string[] = [];
    const service = new AxCommandService(store, {
      runWorkflow: async (workflowId) => {
        ran.push(workflowId);
        return { status: 'queued' };
      },
    });
    const seen: StructuredGenerateInput<unknown>[] = [];
    const presentations: import('../schema.js').AxUiPresentation[] = [];
    const decisionEngine = gmailToSlackRecurringDecisionEngine();
    const harness = new AgentHarness(scriptedModel([], seen));

    const proposed = await runAxCommandChat({
      harness,
      commandService: service,
      decisionEngine,
      connectedConnectors: ['gmail', 'slack'],
      messages: [],
      userMessage: 'Gmail에 새 메일이 오면 요약해서 channel:#ax테스트2로 Slack에 알려주는 반복 업무를 제안해줘. 아직 저장하지 마.',
      workspaceSessionId: chat.id,
      readOperationHints: [{
        key: 'op_0', capabilityId: 'gmail.messages.read', connector: 'gmail',
        label: '메일 읽기', description: '메일 본문 읽기', params: {},
      }],
      onPresentation: (presentation) => presentations.push(presentation),
    });

    expect(proposed).toContain('초안을 확인한 뒤 저장할 수 있습니다');
    expect(presentations[0]?.actions[0]).toMatchObject({ purpose: 'confirm_job', value: JOB_COMMIT_CONFIRM_VALUE });
    expect(store.listWorkflows()).toHaveLength(0);
    expect(seen).toHaveLength(0);

    const confirmSeen: StructuredGenerateInput<unknown>[] = [];
    const confirmHarness = new AgentHarness(scriptedModel([], confirmSeen));
    const committed = await runAxCommandChat({
      harness: confirmHarness,
      commandService: service,
      messages: [{ role: 'assistant', content: proposed, presentations }],
      userMessage: JOB_COMMIT_CONFIRM_VALUE,
      workspaceSessionId: chat.id,
      allowJobCommit: true,
      jobCommitConfirmationToken: presentations[0]?.actions[0]?.id.split(':')[1],
    });

    expect(committed).toContain('반복 업무를 저장하고 활성화했습니다');
    expect(confirmSeen).toHaveLength(0);
    expect(store.listWorkflows()).toHaveLength(1);
    expect(store.listWorkflows()[0]?.active).toBe(true);
    expect(ran).toHaveLength(0);
  });
});
