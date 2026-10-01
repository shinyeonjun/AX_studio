import type { ExecutionLogEntry } from '../../../connectors/types.js';
import { parseWorkflowIR, type WorkflowIR } from '../../../workflow/schema.js';
import { validateExecutionLog } from '../../execution-log.js';
import type { ExecutionResult } from '../../types.js';
import type { WorkflowExecutionHost } from '../contracts.js';

export interface PersistedApprovalExecution {
  id: string;
  irJson?: string;
  logJson?: string;
  workflowId?: string | null;
  ephemeral?: boolean;
}

export type ApprovalResumeSnapshot =
  | { ok: true; ir: WorkflowIR; log: ExecutionLogEntry[] }
  | { ok: false; result: ExecutionResult };

function failResume(
  host: WorkflowExecutionHost,
  approvalId: string,
  executionId: string,
  code: 'invalid_execution_snapshot' | 'invalid_execution_log' | 'workflow_removed',
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
  let generationKey: string | undefined;
  try {
    const snapshot: unknown = JSON.parse(execution.irJson);
    if (snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot)) {
      const key = (snapshot as Record<string, unknown>)._workflowGenerationKey;
      if (typeof key === 'string') generationKey = key;
    }
    ir = parseWorkflowIR(snapshot);
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

  if (ir.id) {
    // Legacy saved approvals are protected by their workflow FK and the
    // pending-execution guard. Unbound legacy ID copies have no generation proof.
    const owned = generationKey !== undefined || (!execution.ephemeral
      && execution.workflowId === ir.id && Boolean(host.config.store.getWorkflow(ir.id, ir.version)));
    if (!owned || !host.isWorkflowGenerationCurrent(ir.id, generationKey)) {
      return failResume(host, approvalId, executionId, 'workflow_removed', '이 승인을 현재 워크플로에 연결할 수 없습니다. 워크플로를 다시 실행해 새 승인을 요청해 주세요.');
    }
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
