import { describe, expect, it } from 'vitest';
import { JOB_COMMIT_CONFIRM_VALUE } from '../../job-registration.js';
import { commandChatContext, connectedService, dailyBriefArgs } from '../fixtures.js';

describe('job.propose successful input normalization', () => {
  it('returns a confirm_job card without saving', async () => {
    const { store, service, chat } = await connectedService();
    const response = await service.execute({
      name: 'job.propose',
      args: dailyBriefArgs,
    }, { ...commandChatContext, workspaceSessionId: chat.id });

    expect(response.status).toBe('ok');
    expect(response.data).toMatchObject({
      saved: false,
      presentation: {
        actions: [{ purpose: 'confirm_job', value: JOB_COMMIT_CONFIRM_VALUE }],
      },
    });
    expect(store.listWorkflows()).toHaveLength(0);
  });

  it('accepts compact string fields the model actually emits', async () => {
    const { store, service, chat } = await connectedService();
    const response = await service.execute({
      name: 'job.propose',
      args: {
        name: 'Daily Dev Brief',
        goal: '전날 GitHub 커밋 리스크를 Slack에 요약한다',
        schedule: '0 21 * * * Asia/Seoul',
        fetch: '/repos/shinyeonjun/AX_studio/commits',
        interpret: '커밋이 없으면 notify=false, 있으면 짧은 리스크/테스트 요약',
        notify: '#ax테스트2',
      },
    }, { ...commandChatContext, workspaceSessionId: chat.id });

    expect(response.status).toBe('ok');
    expect(JSON.stringify(response.issues)).not.toContain('invalid_type');
    expect(response.data).toMatchObject({
      saved: false,
      summary: {
        schedule: '0 21 * * *',
        timezone: 'Asia/Seoul',
        path: '/repos/shinyeonjun/AX_studio/commits',
        channel: '#ax테스트2',
      },
    });
    expect(store.listWorkflows()).toHaveLength(0);
  });

  it('lifts top-level aliases and string booleans a retrying model emits', async () => {
    const { store, service, chat } = await connectedService();
    const response = await service.execute({
      name: 'job.propose',
      args: {
        name: 'Daily Dev Brief',
        goal: '전날 GitHub 커밋 리스크를 Slack에 요약한다',
        schedule: '0 21 * * * Asia/Seoul',
        httpPath: '/repos/shinyeonjun/AX_studio/commits',
        channel: '#ax테스트2',
        connection_id: 'default',
        runOnceNow: 'true',
        allowExternalAuto: 'false',
        notify: { connector: 'slack', channel: '#ax테스트2', skipIfEmpty: 'true' },
      },
    }, { ...commandChatContext, workspaceSessionId: chat.id });

    expect(response.status).toBe('ok');
    expect(response.data).toMatchObject({
      saved: false,
      summary: {
        path: '/repos/shinyeonjun/AX_studio/commits',
        channel: '#ax테스트2',
        connectionId: 'default',
        runOnceNow: true,
        allowExternalAuto: false,
      },
    });
    expect(store.listWorkflows()).toHaveLength(0);
  });
});
