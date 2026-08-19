import { ipcMain } from 'electron';
import { getCore } from '../core-instance.js';
import { notifyStateChanged } from '../state-broadcast.js';

export function registerRuntimeHandlers() {
  ipcMain.handle('ax:saveWorkflow', async (_e, ir) => {
    const core = getCore();
    const result = core.store.saveWorkflow(ir);
    return result;
  });
  ipcMain.handle('ax:runWorkflow', async (_e, workflowId: string) => {
    const core = getCore();
    const ir = core.store.getWorkflow(workflowId);
    if (!ir) throw new Error('Workflow not found');
    return core.runtime.executeWorkflow(ir, { triggerType: 'manual' });
  });
  ipcMain.handle('ax:runEphemeral', async (_e, ir) =>
    getCore().runtime.executeWorkflow(ir, { ephemeral: true, triggerType: 'manual' }),
  );
  ipcMain.handle('ax:approve', async (_e, approvalId: string) => getCore().runtime.continueAfterApproval(approvalId));
  ipcMain.handle('ax:reject', async (_e, approvalId: string) => {
    const core = getCore();
    const approval = core.store.getApproval(approvalId);
    if (!approval) throw new Error('Approval not found');
    core.store.resolveApproval(approvalId, false);
    core.store.finishExecution(approval.executionId, 'cancelled', 'approval_rejected');
    notifyStateChanged();
    return { ok: true };
  });
  ipcMain.handle('ax:deleteWorkflow', async (_e, workflowId: string) => {
    const core = getCore();
    const deleted = core.store.deleteWorkflow(workflowId);
    if (!deleted) throw new Error('Workflow not found');
    core.runtime.removeWorkflow(workflowId);
    return { ok: true };
  });
  ipcMain.handle('ax:deleteExecution', async (_e, executionId: string) => {
    const core = getCore();
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
  ipcMain.handle('ax:setGlobalActive', async (_e, active: boolean) => {
    const core = getCore();
    core.store.setSetting('globalActive', active);
    core.runtime.setGlobalActive(active);
    return { ok: true };
  });
  ipcMain.handle('ax:setWorkflowActive', async (_e, workflowId: string, active: boolean) => {
    const core = getCore();
    core.store.setWorkflowActive(workflowId, active);
    core.runtime.setWorkflowActive(workflowId, active);
    return { ok: true };
  });
}
