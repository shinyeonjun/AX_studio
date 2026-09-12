import type { AppDatabase } from '../db.js';
import { readRows } from '../db/types.js';
import type { ExecutionRow } from '../rows.js';
import { readExecutionLog } from './execution-log.js';

/** Call once at host startup, before any scheduler, trigger or execution starts. */
export function recoverInterruptedExecutions(db: AppDatabase): string[] {
  const interrupted = readRows<Pick<ExecutionRow, 'id' | 'workflow_id' | 'log_json'>>(
    db.prepare(`SELECT id, workflow_id, log_json FROM executions
      WHERE status = 'running' OR (status = 'pending_approval' AND (
        EXISTS (SELECT 1 FROM approvals WHERE execution_id = executions.id AND status = 'processing')
        OR NOT EXISTS (SELECT 1 FROM approvals WHERE execution_id = executions.id AND status = 'pending')
      ))`),
  );
  if (interrupted.length === 0) return [];
  const at = new Date().toISOString();
  db.exec('BEGIN');
  try {
    for (const execution of interrupted) {
      let logJson = execution.log_json;
      try {
        logJson = readExecutionLog(db, execution.id, logJson);
        const log: unknown = JSON.parse(logJson);
        if (Array.isArray(log)) {
          logJson = JSON.stringify([...log, {
            at, level: 'error', code: 'execution_interrupted',
            message: '앱이 종료되어 작업의 완료 여부를 확인할 수 없습니다. 외부 서비스의 처리 결과를 확인한 뒤 다시 실행해 주세요. 연결된 자동 업무는 중지했습니다.',
          }]);
        }
      } catch {
        // Preserve damaged historical evidence; the error code still explains recovery.
      }
      db.prepare(`UPDATE executions SET status = 'failed', finished_at = ?,
        error_code = 'execution_interrupted', log_json = ? WHERE id = ?`)
        .run(at, logJson, execution.id);
      db.prepare(`UPDATE approvals SET status = 'failed', resolved_at = ?
        WHERE execution_id = ? AND status IN ('pending', 'processing')`).run(at, execution.id);
      if (execution.workflow_id) {
        // A previous external action may have completed before the process died.
        // Require the user to inspect it before allowing automatic retries.
        db.prepare('UPDATE workflows SET active = 0, updated_at = ? WHERE id = ?').run(at, execution.workflow_id);
      }
    }
    db.exec('COMMIT');
    return interrupted.map((execution) => execution.id);
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}
