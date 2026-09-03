import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../../engine.js';
import { createTestConnectors } from '../../../../modules/test-connectors.js';

describe('approval continuation execution logs', () => {
  it('fails closed when the persisted approval execution log is malformed', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    const executionId = store.createExecution({
      workflowId: 'workflow-1',
      workflowVersion: 1,
      ephemeral: true,
      irJson: JSON.stringify({ name: '재개', goal: '재개', steps: [], permissions: {}, approval: [], allowExternalAuto: true }),
    });
    db.prepare('UPDATE executions SET log_json = ? WHERE id = ?').run('{broken', executionId);
    const approvalId = store.createApproval({
      executionId,
      actionIds: [],
      reason: '로그 손상 재개 확인',
    });

    const result = await runtime.continueAfterApproval(approvalId);

    expect(result.errorCode).toBe('invalid_execution_log');
    expect(store.getApproval(approvalId)?.status).toBe('failed');
    expect(store.getExecution(executionId)?.errorCode).toBe('invalid_execution_log');
  });

  it('fails closed when the persisted approval execution log has an invalid shape', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });
    const executionId = store.createExecution({
      workflowId: 'workflow-1',
      workflowVersion: 1,
      ephemeral: true,
      irJson: JSON.stringify({ name: '재개', goal: '재개', steps: [], permissions: {}, approval: [], allowExternalAuto: true }),
    });
    db.prepare('UPDATE executions SET log_json = ? WHERE id = ?').run('[null]', executionId);
    const approvalId = store.createApproval({
      executionId,
      actionIds: [],
      reason: '로그 구조 손상 재개 확인',
    });

    const result = await runtime.continueAfterApproval(approvalId);

    expect(result.errorCode).toBe('invalid_execution_log');
    expect(store.getApproval(approvalId)?.status).toBe('failed');
    expect(store.getExecution(executionId)?.errorCode).toBe('invalid_execution_log');
  });
});
