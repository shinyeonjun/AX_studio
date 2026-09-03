import { describe, expect, it } from 'vitest';
import { AxCommandService } from '../../service.js';
import { connectedService, commandChatContext, dailyBriefArgs } from '../fixtures.js';

describe('job.propose required target input', () => {
  it('asks for a Slack channel and does not save a workflow', async () => {
    const { store, service, chat } = await connectedService();
    const response = await service.execute({
      name: 'job.propose',
      args: {
        ...dailyBriefArgs,
        notify: { connector: 'slack', skipIfEmpty: true },
      },
    }, { ...commandChatContext, workspaceSessionId: chat.id });

    expect(response.status).toBe('needs_input');
    expect(response.issues[0]?.code).toBe('job_targets_required');
    expect(response.data).toMatchObject({
      presentation: {
        title: '공유 대상 선택',
        inputs: [{
          id: 'job-slack-channel',
          label: 'Slack 채널',
          type: 'slack_channel',
          required: true,
        }],
        actions: [{ label: '선택하고 공유안 검토' }],
      },
    });
    expect(store.listWorkflows()).toHaveLength(0);
  });
});
