import { ipcHandle } from '../ipc-handle.js';
import { getCore } from '../../core-instance.js';
import { notifyStateChanged } from '../../state-broadcast.js';

export function registerRuntimeExecutionHandlers(): void {
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
