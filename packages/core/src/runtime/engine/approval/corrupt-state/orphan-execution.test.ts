import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { WorkflowRuntime } from '../../../engine.js';
import { createTestConnectors } from '../../../../modules/test-connectors.js';

describe('approval continuation orphan execution', () => {
  it('closes an approval when its execution was deleted before resume', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const runtime = new WorkflowRuntime({ store, globalActive: true, workflowActive: {}, connectors: createTestConnectors() });

    // This is a persisted legacy/corrupt-state test. The live schema enforces
    // approvals.execution_id -> executions.id, so temporarily bypass the
    // constraint only while constructing the orphan row that the runtime must
    // close safely.
    db.exec('PRAGMA foreign_keys = OFF');
    const approvalId = store.createApproval({
      executionId: 'deleted-execution',
      actionIds: ['send_mail'],
      reason: '삭제된 실행 재개 확인',
    });
    db.exec('PRAGMA foreign_keys = ON');

    const result = await runtime.continueAfterApproval(approvalId);

    expect(result.errorCode).toBe('execution_not_found');
    expect(store.getApproval(approvalId)?.status).toBe('failed');
    expect(store.getPendingApprovals()).toHaveLength(0);
  });
});
