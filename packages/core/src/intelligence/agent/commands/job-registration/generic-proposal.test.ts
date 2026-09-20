import { describe, expect, it } from 'vitest';
import { commandChatContext, connectedService } from './fixtures.js';

describe('job.propose generic workflow payloads', () => {
  it('creates a confirmation draft for a Gmail-triggered Slack workflow without HTTP input', async () => {
    const { store, service, chat } = await connectedService();
    store.setConnection('http', false);
    store.setConnection('gmail', true, { email: 'primary' });

    const response = await service.execute({
      name: 'job.propose',
      args: {
        name: 'Gmail 메일 요약',
        goal: '새 Gmail 메일을 요약해 Slack으로 알린다',
        trigger: { type: 'gmail.new_message', accountId: 'primary' },
        steps: [{
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ax테스트', text: '테스트 요약' },
        }],
        runOnceNow: false,
        allowExternalAuto: false,
      },
    }, { ...commandChatContext, workspaceSessionId: chat.id });

    expect(response.status).toBe('ok');
    expect(response.data).toMatchObject({
      saved: false,
      pending: true,
      summary: { name: 'Gmail 메일 요약' },
    });
    expect(JSON.stringify(response.data.presentation)).toContain('실행마다 승인이 필요합니다');
    expect(store.listWorkflows()).toHaveLength(0);
  });

  it('commits the confirmed generic draft without requiring an HTTP connection', async () => {
    const { store, service, chat } = await connectedService();
    store.setConnection('http', false);
    store.setConnection('gmail', true, { email: 'primary' });

    const proposed = await service.execute({
      name: 'job.propose',
      args: {
        name: 'Gmail 메일 요약',
        goal: '새 Gmail 메일을 요약해 Slack으로 알린다',
        trigger: { type: 'gmail.new_message', accountId: 'primary' },
        steps: [{
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ax테스트', text: '테스트 요약' },
        }],
        runOnceNow: false,
      },
    }, { ...commandChatContext, workspaceSessionId: chat.id });
    expect(proposed.status).toBe('ok');

    const committed = await service.execute({ name: 'job.commit', args: {} }, {
      ...commandChatContext,
      workspaceSessionId: chat.id,
      allowJobCommit: true,
    });

    expect(committed.status).toBe('ok');
    expect(store.listWorkflows()).toHaveLength(1);
    const workflowId = (committed.data as { workflowId: string }).workflowId;
    expect(store.getWorkflow(workflowId)?.trigger).toMatchObject({ type: 'gmail.new_message', accountId: 'primary' });
  });

  it('does not fall back to the HTTP proposal path when trigger and steps are incomplete', async () => {
    const { store, service, chat } = await connectedService();
    const response = await service.execute({
      name: 'job.propose',
      args: {
        name: '불완전한 Gmail 업무',
        goal: '새 메일을 처리한다',
        trigger: { type: 'gmail.new_message', accountId: 'primary' },
      },
    }, { ...commandChatContext, workspaceSessionId: chat.id });

    expect(response.status).toBe('needs_input');
    expect(response.issues).toContainEqual(expect.objectContaining({ code: 'workflow_payload_required' }));
    expect(store.listWorkflows()).toHaveLength(0);
  });

  it('normalizes a compact Gmail trigger using the only connected account', async () => {
    const { store, service, chat } = await connectedService();
    store.setConnection('http', false);
    store.setConnection('gmail', true, { email: 'primary' });

    const response = await service.execute({
      name: 'job.propose',
      args: {
        name: 'Gmail 메일 요약',
        goal: '새 Gmail 메일을 요약해 Slack으로 알린다',
        trigger: 'gmail.new_message',
        steps: [{
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { channel: '#ax테스트', text: '테스트 요약' },
        }],
        runOnceNow: false,
        allowExternalAuto: false,
      },
    }, { ...commandChatContext, workspaceSessionId: chat.id });

    expect(response.status).toBe('ok');
    expect(response.data).toMatchObject({
      summary: { trigger: { type: 'gmail.new_message', accountId: 'primary' } },
    });
    expect(store.listWorkflows()).toHaveLength(0);
  });

  it('asks for a missing Slack notification channel before creating a draft', async () => {
    const { store, service, chat } = await connectedService();
    store.setConnection('http', false);
    store.setConnection('gmail', true, { email: 'primary' });

    const response = await service.execute({
      name: 'job.propose',
      args: {
        name: 'Gmail 메일 요약',
        goal: '새 Gmail 메일을 요약해 Slack으로 알린다',
        trigger: { type: 'gmail.new_message', accountId: 'primary' },
        steps: [{
          type: 'action',
          id: 'notify',
          connector: 'slack',
          action: 'message.send',
          params: { text: '테스트 요약' },
        }],
        runOnceNow: false,
      },
    }, { ...commandChatContext, workspaceSessionId: chat.id });

    expect(response.status).toBe('needs_input');
    expect(response.issues).toContainEqual(expect.objectContaining({
      code: 'job_action_target_required',
      path: 'args.steps',
    }));
    expect(response.data).toMatchObject({
      presentation: {
        inputs: [{ id: 'job-slack-channel', type: 'slack_channel', required: true }],
      },
    });
    expect(store.listWorkflows()).toHaveLength(0);
  });
});
