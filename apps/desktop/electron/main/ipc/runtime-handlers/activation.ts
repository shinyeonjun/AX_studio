import { ipcMain } from 'electron';
import { getCore } from '../../core-instance.js';

export function registerRuntimeActivationHandlers(): void {
  ipcMain.handle('ax:deleteWorkflow', async (_e, workflowId: unknown) => {
    const core = getCore();
    if (typeof workflowId !== 'string' || !workflowId.trim()) throw new Error('Workflow id가 필요합니다.');
    const deleted = core.store.deleteWorkflow(workflowId);
    if (!deleted) throw new Error('Workflow not found');
    core.runtime.removeWorkflow(workflowId);
    return { ok: true };
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
