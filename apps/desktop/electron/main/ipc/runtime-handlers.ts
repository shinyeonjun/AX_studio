import { ipcMain } from 'electron';
import { getCore } from '../core-instance.js';

export function registerRuntimeHandlers() {
  ipcMain.handle('ax:saveSkill', async (_e, ir) => getCore().store.saveSkill(ir));
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
    getCore().store.resolveApproval(approvalId, false);
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
