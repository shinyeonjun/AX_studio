import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../store/db.js';
import { WorkflowStore } from '../../../../store/workflow-store.js';
import { explainExecution } from '../../revision/revision.js';

describe('execution explanation boundary', () => {
  it('explains a corrupted execution log instead of throwing', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const executionId = store.createExecution({ ephemeral: true });
    db.prepare('UPDATE executions SET status = ?, error_code = ?, log_json = ? WHERE id = ?').run(
      'failed',
      'execution_failed',
      '{broken',
      executionId,
    );

    const explanation = explainExecution(store, '왜 실패했어?');

    expect(explanation).toContain('실행 로그가 손상되었습니다');
  });
});
