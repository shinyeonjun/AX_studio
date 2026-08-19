import { ipcMain } from 'electron';
import { getCore } from '../core-instance.js';

export function registerRuntimeHandlers() {
  ipcMain.handle('ax:saveSkill', async (_e, ir) => {
    const core = getCore();
    const result = core.store.saveSkill(ir);
    return result;
  });
  ipcMain.handle('ax:runSkill', async (_e, skillId: string) => {
    const core = getCore();
    const ir = core.store.getSkill(skillId);
    if (!ir) throw new Error('Skill not found');
    return core.runtime.executeSkill(ir, { triggerType: 'manual' });
  });
  ipcMain.handle('ax:runEphemeral', async (_e, ir) =>
    getCore().runtime.executeSkill(ir, { ephemeral: true, triggerType: 'manual' }),
  );
  ipcMain.handle('ax:approve', async (_e, approvalId: string) => getCore().runtime.continueAfterApproval(approvalId));
  ipcMain.handle('ax:reject', async (_e, approvalId: string) => {
    const core = getCore();
    const approval = core.store.getApproval(approvalId);
    if (!approval) throw new Error('Approval not found');
    core.store.resolveApproval(approvalId, false);
    core.store.finishExecution(approval.executionId, 'cancelled', 'approval_rejected');
    return { ok: true };
  });
  ipcMain.handle('ax:deleteSkill', async (_e, skillId: string) => {
    const core = getCore();
    const deleted = core.store.deleteSkill(skillId);
    if (!deleted) throw new Error('Skill not found');
    core.runtime.removeSkill(skillId);
    return { ok: true };
  });
  ipcMain.handle('ax:setGlobalActive', async (_e, active: boolean) => {
    const core = getCore();
    core.store.setSetting('globalActive', active);
    core.runtime.setGlobalActive(active);
    return { ok: true };
  });
  ipcMain.handle('ax:setSkillActive', async (_e, skillId: string, active: boolean) => {
    const core = getCore();
    core.store.setSkillActive(skillId, active);
    core.runtime.setSkillActive(skillId, active);
    return { ok: true };
  });
}
