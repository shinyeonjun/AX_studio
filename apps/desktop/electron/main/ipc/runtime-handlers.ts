import { ipcMain } from 'electron';
import { buildManualRunInput, enrichManualRunInput, parseWorkflowIR, validateManualRunInput } from '@ax-studio/core';
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
    if (typeof workflowId !== 'string' || !workflowId.trim()) throw new Error('Workflow id가 필요합니다.');
    const ir = core.store.getWorkflow(workflowId);
    if (!ir) throw new Error('Workflow not found');
    let input: Record<string, unknown>;
    try {
      input = buildManualRunInput(ir, core.store);
    } catch (error) {
      const failureCode = (error as { code?: string }).code ?? 'manual_run_input_failed';
      const message = error instanceof Error ? error.message : String(error);
      const executionId = core.store.createExecution({
        workflowId,
        workflowVersion: ir.version,
        ephemeral: false,
        triggerType: 'manual',
        irJson: JSON.stringify(ir),
      });
      const log = [{
        at: new Date().toISOString(),
        level: 'error' as const,
        code: failureCode,
        message,
      }];
      core.store.finishExecution(executionId, 'failed', failureCode, log);
      notifyStateChanged();
      return { executionId, status: 'failed', errorCode: failureCode, log };
    }
    const enrichedInput = await enrichManualRunInput(ir, core.runtime.connectors, input);
    const validation = validateManualRunInput(ir, enrichedInput);
    if (!validation.ok) {
      const executionId = core.store.createExecution({
        workflowId,
        workflowVersion: ir.version,
        ephemeral: false,
        triggerType: 'manual',
        irJson: JSON.stringify(ir),
      });
      const log = [
        {
          at: new Date().toISOString(),
          level: 'error' as const,
          code: validation.errorCode,
          message: validation.message,
        },
      ];
      core.store.finishExecution(executionId, 'failed', validation.errorCode, log);
      notifyStateChanged();
      return { executionId, status: 'failed', errorCode: validation.errorCode, log };
    }
    return core.runtime.executeWorkflow(ir, {
      triggerType: 'manual',
      input: enrichedInput,
      forceManual: true,
    });
  });
  ipcMain.handle('ax:runEphemeral', async (_e, ir) => {
    const parsed = parseWorkflowIR(ir);
    return getCore().runtime.executeWorkflow(parsed, { ephemeral: true, triggerType: 'manual' });
  });
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
    core.store.finishExecution(approval.executionId, 'cancelled', 'approval_rejected');
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
