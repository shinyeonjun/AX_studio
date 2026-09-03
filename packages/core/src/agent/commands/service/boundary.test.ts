import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { HOST_COMMAND_CONTEXT } from '../access.js';
import { AxCommandService } from '../service.js';
import { commandChatContext } from './fixtures.js';

describe('AxCommandService host and context boundaries', () => {

  it('blocks workflow and runtime side effects at the direct host boundary', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));

    const listed = await service.execute({ name: 'command.list' }, { executionContext: HOST_COMMAND_CONTEXT });
    const entries = (listed.data as { commands: Array<{ name: string }> }).commands;
    expect(entries.map((entry) => entry.name)).not.toContain('workflow.create');
    expect(entries.map((entry) => entry.name)).not.toContain('workflow.run');

    const directCreate = await service.execute({
      name: 'workflow.create',
      args: { name: '직접 호출', goal: 'host 경계를 확인한다' },
    }, { executionContext: HOST_COMMAND_CONTEXT });
    expect(directCreate.status).toBe('forbidden');
    expect(new WorkflowStore(db).listWorkflows()).toHaveLength(0);
  });

  it('keeps context persistence behind the agent boundary and explicit host confirmation', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const service = new AxCommandService(store);
    const workflow = await service.execute({
      name: 'workflow.create',
      args: { name: '정책 workflow', goal: '업무 기준을 저장한다' },
    }, commandChatContext);
    const workflowId = (workflow.data as { workflowId: string }).workflowId;

    const hostAttempt = await service.execute({
      name: 'context.update',
      args: { scope: 'workflow', set: { severity: 'critical' }, confirmed: true },
    }, { executionContext: HOST_COMMAND_CONTEXT, currentWorkflowId: workflowId });
    expect(hostAttempt.status).toBe('forbidden');

    const unconfirmed = await service.execute({
      name: 'context.update',
      args: { scope: 'workflow', set: { severity: 'critical' }, confirmed: true },
    }, { ...commandChatContext, currentWorkflowId: workflowId });
    expect(unconfirmed).toMatchObject({ status: 'needs_input', issues: [{ code: 'context_confirmation_required' }] });
    expect(store.getWorkflowPolicy(workflowId)).toEqual({});

    const confirmed = await service.execute({
      name: 'context.update',
      args: { scope: 'workflow', set: { severity: 'critical', audience: '운영팀' }, confirmed: true },
    }, { ...commandChatContext, currentWorkflowId: workflowId, allowContextUpdate: true });
    expect(confirmed).toMatchObject({
      status: 'ok',
      data: { scope: 'workflow', workflowId, context: { severity: 'critical', audience: '운영팀' } },
    });
    expect(store.getWorkflowPolicy(workflowId)).toEqual({ severity: 'critical', audience: '운영팀' });

    const secondWorkflow = await service.execute({
      name: 'workflow.create',
      args: { name: '다른 정책 workflow', goal: '정책 격리를 확인한다' },
    }, commandChatContext);
    const secondWorkflowId = (secondWorkflow.data as { workflowId: string }).workflowId;
    expect(store.getWorkflowPolicy(secondWorkflowId)).toEqual({});
  });


});
