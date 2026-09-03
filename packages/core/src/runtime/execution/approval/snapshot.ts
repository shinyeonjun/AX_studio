import type { ExecutionLogEntry } from '../../../modules/types.js';
import { parseWorkflowIR, type WorkflowIR } from '../../../workflow/schema.js';
import { validateExecutionLog } from '../../execution-log.js';
import type { ExecutionResult } from '../../types.js';
import type { WorkflowExecutionHost } from '../contracts.js';

export interface PersistedApprovalExecution {
  id: string;
  irJson?: string;
  logJson?: string;
}

export type ApprovalResumeSnapshot =
  | { ok: true; ir: WorkflowIR; log: ExecutionLogEntry[] }
  | { ok: false; result: ExecutionResult };

function failResume(
  host: WorkflowExecutionHost,
  approvalId: string,
  executionId: string,
  code: 'invalid_execution_snapshot' | 'invalid_execution_log',
  message: string,
): ApprovalResumeSnapshot {
  host.config.store.failApproval(approvalId);
  const log = [{
    at: new Date().toISOString(),
    level: 'error' as const,
    code,
    message,
  }];
  host.config.store.finishExecution(executionId, 'failed', code, log);
  const result: ExecutionResult = {
    executionId,
    status: 'failed',
    errorCode: code,
    log,
  };
  host.notifyExecutionFinished(result);
  return { ok: false, result };
}

export function restoreApprovalSnapshot(
  host: WorkflowExecutionHost,
  approvalId: string,
  executionId: string,
  execution: PersistedApprovalExecution,
): ApprovalResumeSnapshot {
  if (!execution.irJson) {
    return failResume(
      host,
      approvalId,
      executionId,
      'invalid_execution_snapshot',
      '승인 재개에 필요한 실행 스냅샷이 없습니다.',
    );
  }

  let ir: WorkflowIR;
  try {
    ir = parseWorkflowIR(JSON.parse(execution.irJson));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failResume(
      host,
      approvalId,
      executionId,
      'invalid_execution_snapshot',
      '승인 재개에 필요한 실행 스냅샷이 손상되었습니다: ' + message,
    );
  }

  try {
    const parsedLog: unknown = JSON.parse(execution.logJson ?? '[]');
    return { ok: true, ir, log: validateExecutionLog(parsedLog) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return failResume(
      host,
      approvalId,
      executionId,
      'invalid_execution_log',
      '승인 재개에 필요한 실행 로그가 손상되었습니다: ' + message,
    );
  }
}
