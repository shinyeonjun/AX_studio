import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../db.js';
import { WorkflowStore } from '../../workflow-store.js';
describe('workflow save version and activation', () => {
  it('allocates a new monotonic version for every save', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const workflow = { id: 'workflow-1', name: '버전 테스트', goal: '저장 버전 확인', version: 1, steps: [], permissions: {}, approval: [], allowExternalAuto: true, assumptions: [], sideEffects: {}, dataPolicy: {} };
    expect(store.saveWorkflow(workflow).version).toBe(1);
    expect(store.saveWorkflow(workflow).version).toBe(2);
    expect(store.getWorkflow('workflow-1')?.version).toBe(2);
  });
  it('persists new workflows as disabled until explicitly enabled', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const { workflowId } = store.saveWorkflow({ id: 'wf-disabled', name: '비활성 저장', goal: 'test', version: 1, steps: [], permissions: {}, approval: [], allowExternalAuto: true, assumptions: [], sideEffects: {}, dataPolicy: {} });
    const listed = store.listWorkflows().find((row) => row.id === workflowId);
    expect(listed?.active).toBe(false);
  });
});
