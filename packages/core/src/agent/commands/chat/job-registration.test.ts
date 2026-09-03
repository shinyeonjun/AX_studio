import { describe, expect, it } from 'vitest';
import { AgentHarness } from '../../harness.js';
import type { StructuredGenerateInput } from '../../model/provider.js';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { runAxCommandChat } from '../chat.js';
import { AxCommandService } from '../service.js';
import { JOB_COMMIT_CONFIRM_VALUE } from '../job-registration.js';
import { scriptedModel } from './fixtures.js';

describe('runAxCommandChat recurring job registration', () => {
  it('registers a recurring job with one propose command and host-commits without another model loop', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('http', true, { baseUrl: 'https://api.github.com/' });
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
    const harness = new AgentHarness(
      scriptedModel([
        {
          kind: 'command',
          command: {
            name: 'job.propose',
            args: {
              name: 'Daily Dev Brief',
              goal: '전날 GitHub 커밋을 요약한다',
              fetch: { method: 'GET', path: '/repos/shinyeonjun/AX_studio/commits' },
              notify: { connector: 'slack', channel: '#ax테스트2' },
            },
          },
        },
        { kind: 'reply', message: '이 답변은 호출되면 안 됩니다.' },
      ], seen),
    );

    const proposed = await runAxCommandChat({
      harness,
      commandService: service,
      messages: [],
      userMessage: '매일 커밋 브리프를 만들어줘',
      workspaceSessionId: chat.id,
      onPresentation: (presentation) => presentations.push(presentation),
    });

    expect(proposed).toContain('Daily Dev Brief');
    expect(presentations[0]?.actions[0]).toMatchObject({ purpose: 'confirm_job', value: JOB_COMMIT_CONFIRM_VALUE });
    expect(store.listWorkflows()).toHaveLength(0);
    expect(seen).toHaveLength(1);

    const confirmSeen: StructuredGenerateInput<unknown>[] = [];
    const confirmHarness = new AgentHarness(scriptedModel([], confirmSeen));
    const committed = await runAxCommandChat({
      harness: confirmHarness,
      commandService: service,
      messages: [{ role: 'assistant', content: proposed, presentations }],
      userMessage: JOB_COMMIT_CONFIRM_VALUE,
      workspaceSessionId: chat.id,
      allowJobCommit: true,
    });

    expect(committed).toContain('저장하고 스케줄을 켰습니다');
    expect(confirmSeen).toHaveLength(0);
    expect(store.listWorkflows()).toHaveLength(1);
    expect(store.listWorkflows()[0]?.active).toBe(true);
    expect(ran).toHaveLength(1);
  });
});
