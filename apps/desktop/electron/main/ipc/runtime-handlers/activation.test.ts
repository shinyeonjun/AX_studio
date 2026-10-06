import { describe, expect, it, vi } from 'vitest';
import { createDatabaseAsync } from '../../../../../../packages/core/src/persistence/db.js';
import { WorkflowStore } from '../../../../../../packages/core/src/persistence/workflow-store.js';

vi.mock('electron', () => ({ ipcMain: { removeHandler: vi.fn(), handle: vi.fn() } }));
vi.mock('../../core-instance.js', () => ({ getCore: vi.fn() }));
import { deleteWorkflowById } from './activation.js';

const base = {
  name: '손상 테스트', goal: 'g', version: 1, inputs: [], steps: [], permissions: {}, approval: [],
  allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {},
};

async function corruptWorkflowStore() {
  const db = await createDatabaseAsync(':memory:');
  const store = new WorkflowStore(db);
  const { workflowId } = store.saveWorkflow({ ...base, id: 'wf-corrupt' });
  db.prepare('UPDATE workflow_versions SET ir_json = ? WHERE workflow_id = ?').run('{not json', workflowId);
  expect(() => store.getWorkflow(workflowId)).toThrow();
  const runtime = { removeWorkflow: vi.fn(async () => undefined) };
  return { db, store, workflowId, core: { store, runtime } as unknown as Parameters<typeof deleteWorkflowById>[0] };
}

describe('ax:deleteWorkflow', () => {
  it('deletes a workflow whose stored definition is corrupt', async () => {
    const { db, store, workflowId, core } = await corruptWorkflowStore();
    await expect(deleteWorkflowById(core, workflowId)).resolves.toEqual({ ok: true });
    expect(store.workflowExists(workflowId)).toBe(false);
    expect(store.claimUnreadableWorkflowDeletion(workflowId)).toBe(false);
    db.close?.();
  });

  it('still refuses to delete a corrupt workflow with an active execution', async () => {
    const { db, store, workflowId, core } = await corruptWorkflowStore();
    store.createExecution({ workflowId, ephemeral: false });
    await expect(deleteWorkflowById(core, workflowId)).rejects.toThrow('실행 중인 워크플로우는 삭제할 수 없습니다.');
    expect(store.workflowExists(workflowId)).toBe(true);
    // The claim is released so a later retry is possible.
    expect(store.claimUnreadableWorkflowDeletion(workflowId)).toBe(true);
    db.close?.();
  });

  it('never uses the unreadable path for a readable workflow or an unknown id', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const { workflowId } = store.saveWorkflow({ ...base, id: 'wf-ok' });
    expect(store.claimUnreadableWorkflowDeletion(workflowId)).toBe(false);
    const core = { store, runtime: { removeWorkflow: vi.fn(async () => undefined) } } as unknown as Parameters<typeof deleteWorkflowById>[0];
    await expect(deleteWorkflowById(core, 'missing')).rejects.toThrow('Workflow not found');
    await expect(deleteWorkflowById(core, workflowId)).resolves.toEqual({ ok: true });
    db.close?.();
  });
});
