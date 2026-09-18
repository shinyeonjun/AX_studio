import { ipcHandle } from '../ipc-handle.js';
import { getCore } from '../../core-instance.js';

export function registerRuntimeActivationHandlers(): void {
  ipcHandle('ax:deleteWorkflow', async (_e, workflowId: unknown) => {
    const core = getCore();
    if (typeof workflowId !== 'string' || !workflowId.trim()) throw new Error('Workflow id가 필요합니다.');
    if (!core.store.getWorkflow(workflowId)) throw new Error('Workflow not found');
    await core.runtime.removeWorkflow(workflowId);
    const deleted = core.store.deleteWorkflow(workflowId);
    if (!deleted) throw new Error('Workflow not found');
    return { ok: true };
  });
  ipcHandle('ax:setGlobalActive', async (_e, active: unknown) => {
    const core = getCore();
    if (typeof active !== 'boolean') throw new Error('전역 실행 상태가 올바르지 않습니다.');
    core.store.setSetting('globalActive', active);
    core.runtime.setGlobalActive(active);
    return { ok: true };
  });
  ipcHandle('ax:setWorkflowActive', async (_e, workflowId: unknown, active: unknown) => {
    const core = getCore();
    if (typeof workflowId !== 'string' || !workflowId.trim()) throw new Error('Workflow id가 필요합니다.');
    if (typeof active !== 'boolean') throw new Error('워크플로우 실행 상태가 올바르지 않습니다.');
    if (!core.store.setWorkflowActive(workflowId, active)) throw new Error('Workflow not found');
    core.runtime.setWorkflowActive(workflowId, active);
    return { ok: true };
  });
}
