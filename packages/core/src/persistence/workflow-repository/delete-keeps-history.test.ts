import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../db.js';
import { WorkflowStore } from '../workflow-store.js';

async function workWithASentRun() {
  const store = new WorkflowStore(await createDatabaseAsync(':memory:'));
  const { workflowId } = store.saveWorkflow({
    id: 'wf-history', name: '주간 보고 발송', goal: '주간 보고 발송', version: 1, inputs: [], steps: [], permissions: {},
    approval: [], allowExternalAuto: false, assumptions: [], sideEffects: {}, dataPolicy: {},
  });
  const executionId = store.createExecution({ workflowId, ephemeral: false });
  const approvalId = store.createApproval({ executionId, actionIds: ['send'], reason: 'Slack 발송' });
  store.finishExecution(executionId, 'success');
  return { store, workflowId, executionId, approvalId };
}

describe('deleting a work and its history', () => {
  it('keeps what ran and what was sent unless asked to clear it', async () => {
    const { store, workflowId, executionId, approvalId } = await workWithASentRun();
    expect(store.deleteWorkflow(workflowId)).toBe(true);
    expect(store.workflowExists(workflowId)).toBe(false);
    expect(store.getExecution(executionId)).toBeTruthy();
    expect(store.getApproval(approvalId)).toBeTruthy();
  });

  it('clears the history too when the person asks', async () => {
    const { store, workflowId, executionId, approvalId } = await workWithASentRun();
    expect(store.deleteWorkflow(workflowId, { deleteHistory: true })).toBe(true);
    expect(store.getExecution(executionId)).toBeFalsy();
    expect(store.getApproval(approvalId)).toBeFalsy();
  });
});
