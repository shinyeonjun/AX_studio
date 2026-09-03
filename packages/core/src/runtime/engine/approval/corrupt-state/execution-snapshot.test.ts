import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../../engine.js';
import { createTestConnectors } from '../../../../modules/test-connectors.js';

describe('approval continuation execution snapshots', () => {
  it('fails closed when an approval execution snapshot is corrupted', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const finished: Array<{ executionId: string; status: string; errorCode?: string }> = [];
    const runtime = new WorkflowRuntime({
      store,
      globalActive: true,
      workflowActive: {},
      connectors: createTestConnectors(),
      onExecutionFinished: (result) => finished.push(result),
    });
    const executionId = store.createExecution({
      workflowId: 'workflow-1',
      workflowVersion: 1,
      ephemeral: true,
      irJson: '{not-json',
    });
    const approvalId = store.createApproval({
      executionId,
      actionIds: ['send_mail'],
      reason: '손상된 스냅샷 재개 확인',
    });

    const result = await runtime.continueAfterApproval(approvalId);

    expect(result.errorCode).toBe('invalid_execution_snapshot');
    expect(store.getApproval(approvalId)?.status).toBe('failed');
    expect(finished).toEqual([expect.objectContaining({
      executionId,
      status: 'failed',
      errorCode: 'invalid_execution_snapshot',
    })]);
  });

  it('fails closed when an approval execution snapshot is absent', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    const executionId = store.createExecution({ workflowId: 'workflow-1', workflowVersion: 1, ephemeral: true });
    const approvalId = store.createApproval({
      executionId,
      actionIds: ['send_mail'],
      reason: '스냅샷 누락 재개 확인',
    });

    const result = await runtime.continueAfterApproval(approvalId);

    expect(result.errorCode).toBe('invalid_execution_snapshot');
    expect(store.getApproval(approvalId)?.status).toBe('failed');
    expect(store.getExecution(executionId)?.errorCode).toBe('invalid_execution_snapshot');
  });
});
