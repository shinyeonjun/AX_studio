import { expect, test } from '@playwright/test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDesktop, launchDesktop, tempRunId } from '../lib/desktop-app.js';

if (process.env.AX_PRODUCT_QA_MODE === 'deterministic' && !process.env.AX_PRODUCT_QA_PRINT) {
  test('calculated output loads on demand, retries read errors and ignores a detached view', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'ax-output-recovery-'));
    const ctx = await launchDesktop({ mode: 'deterministic', dataRoot,
      runId: process.env.AX_PRODUCT_QA_RUN_ID ?? tempRunId(), scenarioId: 'calculated-output-recovery' });
    const errors: string[] = [];
    ctx.page.on('pageerror', error => errors.push(error.message));
    try {
      const initial = await ctx.page.evaluate(() => window.ax.getState());
      await ctx.app.evaluate(({ ipcMain }, initialState) => {
        const state = { ...initialState, outputRequests: 0, outputCompletions: 0,
          executions: [{ id: 'result', ephemeral: true, status: 'success', hasOutput: true,
            startedAt: new Date().toISOString(), triggerType: 'manual' }] };
        ipcMain.removeHandler('ax:getState');
        ipcMain.handle('ax:getState', () => state);
        ipcMain.removeHandler('ax:getExecutionOutput');
        ipcMain.handle('ax:getExecutionOutput', async () => {
          state.outputRequests += 1;
          const attempt = state.outputRequests;
          await new Promise(resolve => setTimeout(resolve, 400));
          state.outputCompletions += 1;
          if (attempt === 1) throw new Error('결과 저장소가 잠겨 있습니다. 다시 시도해 주세요.');
          return { version: 1, fields: [{ path: 'total', valueJson: '600' }] };
        });
      }, initial);
      await ctx.page.reload();
      const activity = ctx.page.locator('.workspace-sidebar-tab', { hasText: '활동' });
      const work = ctx.page.locator('.workspace-sidebar-tab', { hasText: '업무' });
      await activity.click();
      const open = ctx.page.getByRole('button', { name: '계산 결과 보기', exact: true });
      await expect(open).toBeVisible();
      expect(await ctx.page.evaluate(async () => Reflect.get(await window.ax.getState(), 'outputRequests'))).toBe(0);
      await open.focus(); await ctx.page.keyboard.press('Enter');
      await expect(ctx.page.getByRole('button', { name: '계산 결과 불러오는 중…', exact: true })).toBeDisabled();
      await expect(ctx.page.getByRole('alert')).toContainText('결과 저장소가 잠겨 있습니다.');
      await ctx.page.getByRole('button', { name: '계산 결과 다시 불러오기', exact: true }).click();
      await expect(ctx.page.getByRole('region', { name: '계산 결과', exact: true }).locator('pre')).toHaveText('600');
      await expect(ctx.page.getByRole('alert')).toHaveCount(0);
      await work.click(); await activity.click(); await open.click();
      await expect(ctx.page.getByRole('button', { name: '계산 결과 불러오는 중…', exact: true })).toBeVisible();
      await work.click();
      await expect.poll(() => ctx.page.evaluate(async () => Reflect.get(await window.ax.getState(), 'outputCompletions'))).toBe(3);
      await expect(ctx.page.getByRole('region', { name: '계산 결과', exact: true })).toHaveCount(0);
      expect(errors).toEqual([]);
    } finally { await closeDesktop(ctx); rmSync(dataRoot, { recursive: true, force: true }); }
  });
}
