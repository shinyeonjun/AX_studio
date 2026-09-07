import { describe, expect, it } from 'vitest';
import { AxCommandService } from '../../service.js';
import { connectedService, commandChatContext, dailyBriefArgs } from '../fixtures.js';

describe('job.propose target discovery fallback', () => {
  it('keeps a visible input fallback when Slack channel discovery fails', async () => {
    const { store, chat } = await connectedService();
    const service = new AxCommandService(store, {
      readGateway: {
        execute: async () => ({
          tool: 'capabilities.invoke',
          ok: false,
          error: 'slack_error',
        }),
      },
    });

    const response = await service.execute({
      name: 'job.propose',
      args: {
        ...dailyBriefArgs,
        notify: { connector: 'slack', skipIfEmpty: true },
      },
    }, {
      ...commandChatContext,
      workspaceSessionId: chat.id,
      designToolContext: { connections: [], connectedConnectorIds: ['http', 'slack'], connectors: {} },
    });

    expect(response.status).toBe('needs_input');
    expect(response.data).toMatchObject({
      presentation: {
        inputs: [{
          id: 'job-slack-channel',
          reason: 'Slack 채널 목록을 불러오지 못했습니다. 채널 이름 또는 ID를 입력해 주세요.',
        }],
        actions: [{ label: '선택하고 공유안 검토' }],
      },
    });
    expect(store.listWorkflows()).toHaveLength(0);
  });
});
