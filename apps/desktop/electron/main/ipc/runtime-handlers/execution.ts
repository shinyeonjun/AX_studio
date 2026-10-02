import { ipcHandle } from '../ipc-handle.js';
import { getCore } from '../../core-instance.js';
import { notifyStateChanged } from '../../state-broadcast.js';

export function registerRuntimeExecutionHandlers(): void {
  ipcHandle('ax:getExecutionOutput', async (_e, executionId: unknown) => {
    if (typeof executionId !== 'string' || !executionId.trim() || executionId.length > 128) {
      throw new Error('유효한 실행 ID가 필요합니다.');
    }
    return getCore().store.getExecutionOutput(executionId);
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
