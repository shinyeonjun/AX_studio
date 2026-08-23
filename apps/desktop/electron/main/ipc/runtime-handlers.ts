import { ipcMain } from 'electron';
import { getCore } from '../core-instance.js';
import { notifyStateChanged } from '../state-broadcast.js';

function executionLogWithRejection(
  logJson: string | null | undefined,
): unknown[] {
  let log: unknown[] = [];
  if (logJson) {
    try {
      const parsed = JSON.parse(logJson) as unknown;
      if (Array.isArray(parsed)) log = parsed;
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

export function registerRuntimeHandlers() {
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
    core.store.finishExecution(
      approval.executionId,
      'cancelled',
      'approval_rejected',
      executionLogWithRejection(execution?.logJson),
    );
    notifyStateChanged();
    return { ok: true };
  });
  ipcMain.handle('ax:deleteWorkflow', async (_e, workflowId: unknown) => {
    const core = getCore();
    if (typeof workflowId !== 'string' || !workflowId.trim()) throw new Error('Workflow id가 필요합니다.');
    const deleted = core.store.deleteWorkflow(workflowId);
    if (!deleted) throw new Error('Workflow not found');
    core.runtime.removeWorkflow(workflowId);
    return { ok: true };
  });
  ipcMain.handle('ax:deleteExecution', async (_e, executionId: unknown) => {
    const core = getCore();
    if (typeof executionId !== 'string' || !executionId.trim()) throw new Error('Execution id가 필요합니다.');
    const deleted = core.store.deleteExecution(executionId);
    if (!deleted) throw new Error('Execution not found');
    notifyStateChanged();
    return { ok: true };
  });
  ipcMain.handle('ax:clearExecutions', async () => {
    const core = getCore();
    const removed = core.store.clearExecutions();
    notifyStateChanged();
    return { ok: true, removed };
  });
  ipcMain.handle('ax:setGlobalActive', async (_e, active: unknown) => {
    const core = getCore();
    if (typeof active !== 'boolean') throw new Error('전역 실행 상태가 올바르지 않습니다.');
    core.store.setSetting('globalActive', active);
    core.runtime.setGlobalActive(active);
    return { ok: true };
  });
  ipcMain.handle('ax:setWorkflowActive', async (_e, workflowId: unknown, active: unknown) => {
    const core = getCore();
    if (typeof workflowId !== 'string' || !workflowId.trim()) throw new Error('Workflow id가 필요합니다.');
    if (typeof active !== 'boolean') throw new Error('워크플로우 실행 상태가 올바르지 않습니다.');
    if (!core.store.setWorkflowActive(workflowId, active)) throw new Error('Workflow not found');
    core.runtime.setWorkflowActive(workflowId, active);
    return { ok: true };
  });
}
