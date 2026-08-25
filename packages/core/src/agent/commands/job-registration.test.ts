import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../store/db.js';
import { WorkflowStore } from '../../store/workflow-store.js';
import { HOST_COMMAND_CONTEXT } from './access.js';
import {
  compileScheduledHttpSlackJob,
  JOB_COMMIT_CONFIRM_VALUE,
} from './job-registration.js';
import { AxCommandService } from './service.js';
import { validateWorkflowContracts } from '../../workflow/contract-validator.js';

const commandChatContext = { executionContext: { origin: 'agent' as const } };

const dailyBriefArgs = {
  name: 'Daily Dev Brief',
  goal: '전날 GitHub 커밋 리스크를 Slack에 요약한다',
  schedule: { cron: '0 21 * * *', timezone: 'Asia/Seoul' },
  fetch: { method: 'GET' as const, path: '/repos/shinyeonjun/AX_studio/commits' },
  interpret: { goal: '커밋이 없으면 notify=false, 있으면 짧은 리스크/테스트 요약' },
  notify: { connector: 'slack' as const, channel: '#ax테스트2', skipIfEmpty: true },
  runOnceNow: true,
  allowExternalAuto: true,
};

async function connectedService(runWorkflow?: (workflowId: string) => Promise<unknown>) {
  const db = await createDatabaseAsync(':memory:');
  const store = new WorkflowStore(db);
  store.setConnection('http', true, { baseUrl: 'https://api.github.com/' });
  store.setConnection('slack', true);
  const chat = store.saveWorkspaceChat({ messages: [] });
  const service = new AxCommandService(store, { runWorkflow });
  return { store, service, chat };
}

describe('compileScheduledHttpSlackJob', () => {
  it('builds a scheduled HTTP GET → AI brief → Slack notify workflow', () => {
    const ir = compileScheduledHttpSlackJob({
      name: 'Daily Dev Brief',
      goal: '커밋 브리프',
      cron: '0 21 * * *',
      timezone: 'Asia/Seoul',
      path: '/repos/shinyeonjun/AX_studio/commits',
      interpretGoal: '리스크 요약',
      channel: '#ax테스트2',
      skipIfEmpty: true,
      runOnceNow: true,
      allowExternalAuto: true,
    });

    expect(ir.trigger).toEqual({ type: 'schedule', schedule: '0 21 * * *', timezone: 'Asia/Seoul' });
    expect(ir.allowExternalAuto).toBe(true);
    expect(ir.steps.map((step) => step.id)).toEqual(['fetch', 'brief', 'should_notify', 'notify']);
    expect(validateWorkflowContracts(ir, { connectedConnectors: ['http', 'slack'] })).toEqual([]);
  });
});

describe('job.propose / job.commit', () => {
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
    expect(response.issues[0]?.code).toBe('missing_argument');
    expect(response.issues[0]?.message).toContain('channel');
    expect(store.listWorkflows()).toHaveLength(0);
  });

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

  it('does not leak Zod JSON when propose arguments are unusable', async () => {
    const { service, chat } = await connectedService();
    const response = await service.execute({
      name: 'job.propose',
      args: { name: 1, goal: true },
    }, { ...commandChatContext, workspaceSessionId: chat.id });

    expect(response.status).toBe('invalid');
    expect(response.issues[0]?.message).toBe('업무 초안 형식이 올바르지 않습니다.');
    expect(JSON.stringify(response)).not.toContain('invalid_type');
  });

  it('rejects commit without a prior propose or host confirmation', async () => {
    const { store, service, chat } = await connectedService();
    const withoutFlag = await service.execute({ name: 'job.commit', args: {} }, {
      ...commandChatContext,
      workspaceSessionId: chat.id,
    });
    expect(withoutFlag.status).toBe('forbidden');
    expect(store.listWorkflows()).toHaveLength(0);

    const withoutDraft = await service.execute({ name: 'job.commit', args: {} }, {
      ...commandChatContext,
      workspaceSessionId: chat.id,
      allowJobCommit: true,
    });
    expect(withoutDraft.status).toBe('not_found');
    expect(store.listWorkflows()).toHaveLength(0);
  });

  it('commits the proposed job, activates the schedule, and can run once', async () => {
    const ran: string[] = [];
    const { store, service, chat } = await connectedService(async (workflowId) => {
      ran.push(workflowId);
      return { status: 'queued' };
    });

    await service.execute({
      name: 'job.propose',
      args: dailyBriefArgs,
    }, { ...commandChatContext, workspaceSessionId: chat.id });

    const committed = await service.execute({ name: 'job.commit', args: {} }, {
      ...commandChatContext,
      workspaceSessionId: chat.id,
      allowJobCommit: true,
    });

    expect(committed.status).toBe('ok');
    const workflowId = (committed.data as { workflowId: string }).workflowId;
    expect(store.listWorkflows()).toEqual([
      expect.objectContaining({ id: workflowId, active: true, name: 'Daily Dev Brief' }),
    ]);
    const workflow = store.getWorkflow(workflowId);
    expect(workflow?.allowExternalAuto).toBe(true);
    expect(workflow?.trigger).toMatchObject({ type: 'schedule', schedule: '0 21 * * *' });
    expect(store.getWorkspaceChat(chat.id)?.workflowId).toBe(workflowId);
    expect(ran).toEqual([workflowId]);
  });

  it('fails closed when HTTP is disconnected or the path leaves the origin', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    store.setConnection('slack', true);
    const chat = store.saveWorkspaceChat({ messages: [] });
    const service = new AxCommandService(store);

    const disconnected = await service.execute({
      name: 'job.propose',
      args: dailyBriefArgs,
    }, { ...commandChatContext, workspaceSessionId: chat.id });
    expect(disconnected.status).toBe('invalid');
    expect(disconnected.issues[0]?.code).toBe('http_connection_required');
    expect(store.listWorkflows()).toHaveLength(0);

    store.setConnection('http', true, { baseUrl: 'https://api.github.com/' });
    const offOrigin = await service.execute({
      name: 'job.propose',
      args: {
        ...dailyBriefArgs,
        fetch: { method: 'GET', path: 'https://evil.example/steal' },
      },
    }, { ...commandChatContext, workspaceSessionId: chat.id });
    expect(offOrigin.status).toBe('invalid');
    expect(offOrigin.issues[0]?.code).toBe('http_origin_rejected');
    expect(store.listWorkflows()).toHaveLength(0);
  });

  it('hides job.commit from command.list and keeps job.propose on the agent boundary', async () => {
    const { service } = await connectedService();
    const host = await service.execute({ name: 'command.list' }, { executionContext: HOST_COMMAND_CONTEXT });
    const hostNames = (host.data as { commands: Array<{ name: string }> }).commands.map((entry) => entry.name);
    expect(hostNames).not.toContain('job.propose');
    expect(hostNames).not.toContain('job.commit');

    const agent = await service.execute({ name: 'command.list' }, commandChatContext);
    const agentNames = (agent.data as { commands: Array<{ name: string }> }).commands.map((entry) => entry.name);
    expect(agentNames).toContain('job.propose');
    expect(agentNames).not.toContain('job.commit');
  });
});
