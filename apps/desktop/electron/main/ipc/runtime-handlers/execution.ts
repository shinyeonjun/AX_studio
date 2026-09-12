import { ipcHandle } from '../ipc-handle.js';
import { getCore } from '../../core-instance.js';
import { notifyStateChanged } from '../../state-broadcast.js';
import { runSavedWorkflowById } from '@ax-studio/core';

export function registerRuntimeExecutionHandlers(): void {
  ipcHandle('ax:runWorkflow', async (_e, workflowId: unknown) => {
    if (typeof workflowId !== 'string' || !workflowId.trim()) throw new Error('업무를 선택해 주세요.');
    const core = getCore();
    // A manual run never modifies the saved schedule or bypasses external approval.
    const execution = runSavedWorkflowById(core, workflowId);
    notifyStateChanged();
    try {
      const result = await execution;
      return { executionId: result.executionId, status: result.status };
    } finally { notifyStateChanged(); }
  });
  ipcHandle('ax:deleteExecution', async (_e, executionId: unknown) => {
    const core = getCore();
    if (typeof executionId !== 'string' || !executionId.trim()) throw new Error('Execution id가 필요합니다.');
    const deleted = core.store.deleteExecution(executionId);
    if (!deleted) throw new Error('Execution not found');
    notifyStateChanged();
    return { ok: true };
  });
  ipcHandle('ax:clearExecutions', async () => {
    const core = getCore();
    const removed = core.store.clearExecutions();
    notifyStateChanged();
    return { ok: true, removed };
  });
}
