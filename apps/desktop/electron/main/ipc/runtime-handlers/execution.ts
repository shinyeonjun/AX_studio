import { ipcHandle } from '../ipc-handle.js';
import { getCore } from '../../core-instance.js';
import { notifyStateChanged } from '../../state-broadcast.js';

export function registerRuntimeExecutionHandlers(): void {
  ipcHandle('ax:getExecutionOutput', async (_e, executionId: unknown) => {
    if (typeof executionId !== 'string' || !executionId.trim() || executionId.length > 128) {
      throw new Error('실행 기록을 찾을 수 없어요. 화면을 새로고침해 주세요.');
    }
    return getCore().store.getExecutionOutput(executionId);
  });
  ipcHandle('ax:deleteExecution', async (_e, executionId: unknown) => {
    const core = getCore();
    if (typeof executionId !== 'string' || !executionId.trim()) throw new Error('실행 기록을 찾을 수 없어요. 화면을 새로고침해 주세요.');
    const deleted = core.store.deleteExecution(executionId);
    if (!deleted) throw new Error('실행 기록을 찾을 수 없어요. 이미 삭제됐을 수 있어요.');
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
