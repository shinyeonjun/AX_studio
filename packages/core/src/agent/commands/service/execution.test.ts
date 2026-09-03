import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../store/db.js';
import { WorkflowStore } from '../../../store/workflow-store.js';
import { AxCommandService } from '../service.js';
import { commandChatContext } from './fixtures.js';

describe('AxCommandService saved execution', () => {
  it('runs only an existing workflow through the injected runtime boundary', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runCalls: string[] = [];
    const service = new AxCommandService(store, {
      runWorkflow: async (workflowId) => {
        runCalls.push(workflowId);
        return { executionId: 'execution-1', status: 'succeeded' };
      },
    });

    const created = await service.execute({
      name: 'workflow.create',
      args: { name: '실행 테스트', goal: '실행 경계를 확인한다' },
    }, commandChatContext);
    const workflowId = (created.data as { workflowId: string }).workflowId;

    const run = await service.execute(
      { name: 'workflow.run', args: { workflowId } },
      commandChatContext,
    );

    expect(run).toMatchObject({
      command: 'workflow.run',
      status: 'ok',
      data: { executionId: 'execution-1' },
    });
    expect(runCalls).toEqual([workflowId]);
  });

  it('allows the agent command to persist a workflow without a separate user mode', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runCalls: string[] = [];
    const service = new AxCommandService(store, {
      runWorkflow: async (workflowId) => {
        runCalls.push(workflowId);
        return { executionId: 'execution-1', status: 'succeeded' };
      },
    });

    const create = await service.execute({
      name: 'workflow.create',
      args: { name: '대화 workflow', goal: '자연어 command로 저장한다' },
    }, commandChatContext);

    expect(create).toMatchObject({ status: 'ok', data: { operation: 'created' } });
    expect(store.listWorkflows()).toHaveLength(1);
    expect(runCalls).toHaveLength(0);
  });

  it('runs a saved workflow through the command lifecycle', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runCalls: string[] = [];
    const service = new AxCommandService(store, {
      runWorkflow: async (workflowId) => {
        runCalls.push(workflowId);
        return { executionId: 'execution-1', status: 'succeeded' };
      },
    });

    const created = await service.execute(
      { name: 'workflow.create', args: { name: '저장 workflow', goal: '설계 중 실행하지 않는다' } },
      commandChatContext,
    );
    const workflowId = (created.data as { workflowId: string }).workflowId;
    const run = await service.execute(
      { name: 'workflow.run', args: { workflowId } },
      commandChatContext,
    );

    expect(run).toMatchObject({ status: 'ok', data: { executionId: 'execution-1' } });
    expect(runCalls).toEqual([workflowId]);
  });

});
