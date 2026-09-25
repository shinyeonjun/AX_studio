import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../../../../persistence/db.js';
import { WorkflowStore } from '../../../../../persistence/workflow-store.js';
import { WorkflowRuntime } from '../../../../../runtime/engine.js';
import type { WorkflowIR } from '../../../../../workflow/schema.js';
import { AxCommandService } from '../../service.js';
import { commandChatContext } from '../fixtures.js';
describe('AxCommandService versioned workflow commands', () => {
  it('creates, updates, and deletes through one versioned command boundary', async () => {
    const db = await createDatabaseAsync(':memory:');
    const service = new AxCommandService(new WorkflowStore(db));
    const created = await service.execute({
      name: 'workflow.create',
      args: { name: '명령 테스트', goal: '명령으로 수정한다' },
    }, commandChatContext);
    expect(created.status).toBe('ok');
    const createdData = created.data as { workflowId: string; version: number };
    expect(createdData.version).toBe(1);
    const updated = await service.execute({
      name: 'workflow.update',
      args: {
        workflowId: createdData.workflowId,
        baseVersion: createdData.version,
        operations: [
          { op: 'set', path: 'name', value: '수정된 workflow' },
          {
            op: 'upsert_step',
            step: {
              type: 'action',
              id: 'notify',
              connector: 'slack',
              action: 'message.send',
              params: { channel: '#ops', text: 'hello' },
            },
          },
        ],
      },
    }, { ...commandChatContext, currentWorkflowId: createdData.workflowId });
    expect(updated.status).toBe('ok');
    expect(updated.data).toMatchObject({ version: 2, workflow: { name: '수정된 workflow' } });

    const stale = await service.execute({
      name: 'workflow.update',
      args: {
        workflowId: createdData.workflowId,
        baseVersion: 1,
        operations: [{ op: 'set', path: 'goal', value: '오래된 수정' }],
      },
    }, { ...commandChatContext, currentWorkflowId: createdData.workflowId });
    expect(stale.status).toBe('conflict');
    const deleted = await service.execute({
      name: 'workflow.delete',
      args: { workflowId: createdData.workflowId, baseVersion: 2 },
    }, { ...commandChatContext, currentWorkflowId: createdData.workflowId });
    expect(deleted).toMatchObject({ status: 'ok', data: { deleted: true } });
  });

  it('waits for runtime removal before deleting a workflow from the command path', async () => {
    const db = await createDatabaseAsync(':memory:');
    const removeWorkflow = vi.fn(async () => undefined);
    const service = new AxCommandService(new WorkflowStore(db), { removeWorkflow });
    try {
      const created = await service.execute({
        name: 'workflow.create',
        args: { name: '삭제 순서 테스트', goal: 'runtime 정리 후 삭제' },
      }, commandChatContext);
      const workflowId = (created.data as { workflowId: string }).workflowId;
      const deleted = await service.execute({
        name: 'workflow.delete',
        args: { workflowId, baseVersion: 1 },
      }, { ...commandChatContext, currentWorkflowId: workflowId });

      expect(deleted).toMatchObject({ status: 'ok', data: { deleted: true } });
      expect(removeWorkflow).toHaveBeenCalledExactlyOnceWith(workflowId);
    } finally {
      db.close?.();
    }
  });

  it('drains an active run before the delete command removes its workflow and execution', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const workflow: WorkflowIR = {
      id: 'workflow-delete-active-run',
      name: '삭제 경합 테스트',
      goal: '실행 정리 후 삭제',
      version: 1,
      steps: [{
        type: 'action',
        id: 'read',
        connector: 'gmail',
        action: 'messages.search',
        params: { query: 'pending' },
        sideEffect: 'NONE',
      }],
      permissions: {}, approval: [], allowExternalAuto: false,
      assumptions: [], sideEffects: {}, dataPolicy: {},
    };
    store.saveWorkflow(workflow);

    let entered!: () => void;
    const enteredPromise = new Promise<void>((resolve) => { entered = resolve; });
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: { [workflow.id!]: true },
      connectors: {
        gmail: {
          name: 'gmail',
          execute: async (_action, _params, ctx) => await new Promise((_resolve, reject) => {
            entered();
            ctx.abortSignal?.addEventListener('abort', () => {
              reject(ctx.abortSignal?.reason ?? new DOMException('aborted', 'AbortError'));
            }, { once: true });
          }),
        },
      },
    });
    const service = new AxCommandService(store, {
      removeWorkflow: (workflowId) => runtime.removeWorkflow(workflowId),
    });
    let run: ReturnType<WorkflowRuntime['executeWorkflow']> | undefined;

    try {
      run = runtime.executeWorkflow(workflow);
      await enteredPromise;
      const deletion = service.execute({
        name: 'workflow.delete',
        args: { workflowId: workflow.id, baseVersion: workflow.version },
      }, { ...commandChatContext, currentWorkflowId: workflow.id });

      await expect(runtime.executeWorkflow(workflow)).rejects.toMatchObject({ code: 'workflow_removed' });
      await expect(run).resolves.toMatchObject({ status: 'cancelled', errorCode: 'cancelled' });
      await expect(deletion).resolves.toMatchObject({ status: 'ok', data: { deleted: true } });
      expect(store.getWorkflow(workflow.id!)).toBeNull();
      expect(store.listExecutions()).toHaveLength(0);
    } finally {
      if (run) {
        await runtime.removeWorkflow(workflow.id!);
        await run.catch(() => undefined);
      }
      db.close?.();
    }
  });

  it('rejects workflow updates while a versioned deletion owns the workflow', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    let markRemovalStarted!: () => void;
    let finishRemoval!: () => void;
    const removalStarted = new Promise<void>((resolve) => { markRemovalStarted = resolve; });
    const removalGate = new Promise<void>((resolve) => { finishRemoval = resolve; });
    const service = new AxCommandService(store, {
      removeWorkflow: async () => {
        markRemovalStarted();
        await removalGate;
      },
    });
    try {
      const created = await service.execute({
        name: 'workflow.create',
        args: { name: '경쟁 조건 테스트', goal: '삭제와 수정의 순서를 보장한다' },
      }, commandChatContext);
      const workflowId = (created.data as { workflowId: string }).workflowId;
      const deletion = service.execute({
        name: 'workflow.delete',
        args: { workflowId, baseVersion: 1 },
      }, { ...commandChatContext, currentWorkflowId: workflowId });
      await removalStarted;

      const update = await service.execute({
        name: 'workflow.update',
        args: {
          workflowId,
          baseVersion: 1,
          operations: [{ op: 'set', path: 'name', value: '삭제 중 수정' }],
        },
      }, { ...commandChatContext, currentWorkflowId: workflowId });
      expect(update.status).toBe('conflict');
      finishRemoval();

      const deleted = await deletion;
      expect(deleted.status).toBe('ok');
      expect(store.getWorkflow(workflowId)).toBeNull();
    } finally {
      finishRemoval();
      db.close?.();
    }
  });

  it('keeps the workflow when runtime cleanup fails', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const service = new AxCommandService(store, {
      removeWorkflow: vi.fn(async () => { throw new Error('runtime cleanup failed'); }),
    });
    try {
      const created = await service.execute({
        name: 'workflow.create',
        args: { name: '삭제 실패 테스트', goal: '실패 시 보존' },
      }, commandChatContext);
      const workflowId = (created.data as { workflowId: string }).workflowId;
      const deleted = await service.execute({
        name: 'workflow.delete',
        args: { workflowId, baseVersion: 1 },
      }, { ...commandChatContext, currentWorkflowId: workflowId });

      expect(deleted).toMatchObject({ status: 'error' });
      expect(store.getWorkflow(workflowId)).toBeDefined();

      const updated = await service.execute({
        name: 'workflow.update',
        args: {
          workflowId,
          baseVersion: 1,
          operations: [{ op: 'set', path: 'name', value: '삭제 실패 후 수정 가능' }],
        },
      }, { ...commandChatContext, currentWorkflowId: workflowId });
      expect(updated.status).toBe('ok');
    } finally {
      db.close?.();
    }
  });
});
