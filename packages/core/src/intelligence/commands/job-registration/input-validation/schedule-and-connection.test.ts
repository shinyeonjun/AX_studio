import { describe, expect, it } from 'vitest';
import { commandChatContext, connectedService, dailyBriefArgs } from '../fixtures.js';

describe('job.propose schedule and connection validation', () => {
  it('rejects an invalid timezone before proposing a job that can never run', async () => {
    const { store, service, chat } = await connectedService();
    const response = await service.execute({
      name: 'job.propose',
      args: {
        name: 'Daily Dev Brief',
        goal: '전날 GitHub 커밋 리스크를 Slack에 요약한다',
        schedule: { cron: '0 21 * * *', timezone: 'Mars/Olympus' },
        fetch: '/repos/shinyeonjun/AX_studio/commits',
        notify: '#ax테스트2',
      },
    }, { ...commandChatContext, workspaceSessionId: chat.id });

    expect(response.status).toBe('invalid');
    expect(response.issues).toContainEqual(expect.objectContaining({
      code: 'invalid_schedule',
      path: 'args.schedule.timezone',
    }));
    expect(store.listWorkflows()).toHaveLength(0);
  });

  it('reports an unknown connection name with the available connections', async () => {
    const { store, service, chat } = await connectedService();
    store.setConnection('http', true, {
      endpoints: [
        { id: 'default', baseUrl: 'https://api.github.com/', label: 'GitHub' },
        { id: 'tickets', baseUrl: 'https://api.example.com/v1/', label: 'Tickets' },
      ],
    });

    const response = await service.execute({
      name: 'job.propose',
      args: {
        ...dailyBriefArgs,
        fetch: { ...dailyBriefArgs.fetch, connectionId: 'NoSuchApi' },
      },
    }, { ...commandChatContext, workspaceSessionId: chat.id });

    expect(response.status).toBe('invalid');
    expect(response.issues[0]?.code).toBe('http_connection_not_found');
    expect(response.issues[0]?.message).toContain('GitHub');
    expect(response.issues[0]?.message).toContain('Tickets');
    expect(store.listWorkflows()).toHaveLength(0);
  });
});
