import { ipcMain } from 'electron';
import type { ExecutionLogEntry, ExecutionResult } from '@ax-studio/core';
import { getCore } from '../../core-instance.js';
import { notifyStateChanged } from '../../state-broadcast.js';

function executionLogWithRejection(
  logJson: string | null | undefined,
): ExecutionLogEntry[] {
  let log: ExecutionLogEntry[] = [];
  if (logJson) {
    try {
      const parsed = JSON.parse(logJson) as unknown;
      if (Array.isArray(parsed)) {
        log = parsed.filter((entry): entry is ExecutionLogEntry => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
          const candidate = entry as Record<string, unknown>;
          return typeof candidate.at === 'string' &&
            (candidate.level === 'info' || candidate.level === 'warn' || candidate.level === 'error') &&
            typeof candidate.message === 'string';
        });
      }
    } catch {
      // Keep the cancellation auditable even when an older execution has a
      // malformed log. The original malformed payload must not block the
      // state transition.
    }
  }
  return [
    ...log,
    {
      at: new Date().toISOString(),
      level: 'warn',
      code: 'approval_rejected',
      message: '승인이 거절되어 실행을 취소했습니다.',
    },
  ];
}

export function registerRuntimeApprovalHandlers(): void {
  ipcMain.handle('ax:approve', async (_e, approvalId: unknown) => {
    const core = getCore();
    if (typeof approvalId !== 'string' || !approvalId.trim()) throw new Error('approvalId가 필요합니다.');
    const result = await core.runtime.continueAfterApproval(approvalId);
    notifyStateChanged();
    if (result.status === 'failed') {
      const lastError = result.log?.filter((entry) => entry.level === 'error').at(-1);
      throw new Error(lastError?.message ?? '승인 후 실행에 실패했습니다.');
    }
    return result;
  });
  ipcMain.handle('ax:reject', async (_e, approvalId: unknown) => {
    const core = getCore();
    if (typeof approvalId !== 'string' || !approvalId.trim()) throw new Error('approvalId가 필요합니다.');
    const approval = core.store.getApproval(approvalId);
    if (!approval) throw new Error('Approval not found');
    if (!core.store.rejectPendingApproval(approvalId)) {
      throw new Error('Approval is already being processed or resolved');
    }
    const execution = core.store.getExecution(approval.executionId);
    const rejectionLog = executionLogWithRejection(execution?.logJson);
    core.store.finishExecution(
      approval.executionId,
      'cancelled',
      'approval_rejected',
      rejectionLog,
    );
    const rejectionResult: ExecutionResult = {
      executionId: approval.executionId,
      status: 'cancelled',
      errorCode: 'approval_rejected',
      log: rejectionLog,
    };
    core.runtime.notifyExecutionFinished(rejectionResult);
    notifyStateChanged();
    return { ok: true };
  });
}
