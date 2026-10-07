import { describe, expect, it } from 'vitest';
import { createDatabaseAsync } from '../../../../persistence/db.js';
import { WorkflowStore } from '../../../../persistence/workflow-store.js';
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

  it('summarizes the latest run in readable Korean for non-failure questions', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const executionId = store.createExecution({ ephemeral: true });
    const ir = { name: '월간 보고서', steps: [{ type: 'action', id: 's1', connector: 'http', action: 'request' }] };
    db.prepare('UPDATE executions SET status = ?, ir_json = ?, trigger_type = ? WHERE id = ?').run(
      'success', JSON.stringify(ir), 'manual', executionId,
    );

    const explanation = explainExecution(store, '지난번 보고서는 어떤 데이터로 만들었어?');

    expect(explanation).toContain('「월간 보고서」(수동 실행)');
    expect(explanation).toContain('상태는 성공');
    expect(explanation).toContain('실행 단계: http.request');
    expect(explanation).not.toMatch(/\d{4}-\d{2}-\d{2}T/);
  });

  it('does not treat greetings containing 안 as failure questions', async () => {
    const db = await createDatabaseAsync(':memory:');
    const store = new WorkflowStore(db);
    const executionId = store.createExecution({ ephemeral: true });
    db.prepare('UPDATE executions SET status = ?, error_code = ? WHERE id = ?').run('failed', 'execution_failed', executionId);

    expect(explainExecution(store, '안녕')).toContain('상태는 실패');
    expect(explainExecution(store, '왜 안 됐어?')).toContain('다음에 할 일');
  });
});
