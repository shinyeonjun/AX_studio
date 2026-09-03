import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { describe, expect, it } from 'vitest';
import { commandChatContext, connectedService, dailyBriefArgs } from './fixtures.js';
import { AxCommandService } from '../service.js';

describe('job commit and fail-closed execution', () => {
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
    const fetch = workflow?.steps.find((step) => step.id === 'fetch');
    expect(fetch && 'params' in fetch ? fetch.params : undefined).toMatchObject({
      connectionId: 'default',
      path: '/repos/shinyeonjun/AX_studio/commits',
    });
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
});
