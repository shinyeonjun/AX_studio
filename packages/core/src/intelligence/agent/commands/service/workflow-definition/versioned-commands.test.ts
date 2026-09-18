import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../../../../persistence/db.js';
import { WorkflowStore } from '../../../../../persistence/workflow-store.js';
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
    }, commandChatContext);
    expect(updated.status).toBe('ok');
    expect(updated.data).toMatchObject({ version: 2, workflow: { name: '수정된 workflow' } });

    const stale = await service.execute({
      name: 'workflow.update',
      args: {
        workflowId: createdData.workflowId,
        baseVersion: 1,
        operations: [{ op: 'set', path: 'goal', value: '오래된 수정' }],
      },
    }, commandChatContext);
    expect(stale.status).toBe('conflict');
    const deleted = await service.execute({
      name: 'workflow.delete',
      args: { workflowId: createdData.workflowId, baseVersion: 2 },
    }, commandChatContext);
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
      }, commandChatContext);

      expect(deleted).toMatchObject({ status: 'ok', data: { deleted: true } });
      expect(removeWorkflow).toHaveBeenCalledExactlyOnceWith(workflowId);
    } finally {
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
      }, commandChatContext);

      expect(deleted).toMatchObject({ status: 'error' });
      expect(store.getWorkflow(workflowId)).toBeDefined();
    } finally {
      db.close?.();
    }
  });
});
