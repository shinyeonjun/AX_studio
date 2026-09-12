import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDesktop, launchDesktop, tempRunId, type DesktopContext } from '../lib/desktop-app.js';
import { openSettingsLink, openSidebarTab, publishDiscovery, waitForDiscoveryStatus } from '../lib/ui.js';

if (process.env.AX_PRODUCT_QA_MODE === 'deterministic' && !process.env.AX_PRODUCT_QA_PRINT) {
  test('real discovery: publish, run latest connected data, reopen results and reject schema drift', async () => {
    const root = mkdtempSync(join(tmpdir(), 'ax-discovery-product-'));
    const folder = join(root, 'source');
    mkdirSync(folder);
    const source = join(folder, 'sales.csv');
    const example = join(root, 'report.csv');
    writeFileSync(source, 'amount\n100\n100\n100\n');
    writeFileSync(example, 'total\n300\n');
    const runId = process.env.AX_PRODUCT_QA_RUN_ID ?? tempRunId();
    let ctx: DesktopContext | undefined;
    const options = { mode: 'deterministic' as const, realEngines: true,
      dataRoot: join(root, 'profile'), runId, scenarioId: 'discovery-execution' };
    try {
      ctx = await launchDesktop(options);
      // Replace only the native file chooser, not renderer IPC, source grants or business logic.
      await ctx.app.evaluate(({ dialog }, paths) => {
        const remaining = [...paths];
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [remaining.shift()!] });
      }, [folder, example]);
      await openSidebarTab(ctx.page, 'settings');
      await openSettingsLink(ctx.page, '로컬 폴더');
      await ctx.page.getByRole('button', { name: '찾아보기', exact: true }).click();
      await ctx.page.getByRole('button', { name: '폴더 연결 추가', exact: true }).click();
      await expect(ctx.page.getByText('폴더가 연결되었습니다.', { exact: true })).toBeVisible();
      await openSidebarTab(ctx.page, 'work');
      await ctx.page.getByRole('button', { name: '지난 결과물 첨부하기', exact: true }).click();
      await waitForDiscoveryStatus(ctx.page, 'ready_to_publish', 30_000);
      await publishDiscovery(ctx.page);
      const state = await ctx.page.evaluate(() => window.ax.getState());
      expect(state.works).toHaveLength(1);
      const work = state.works[0]!;

      // The next input differs from the source snapshot used during replay.
      writeFileSync(source, 'amount\n200\n200\n200\n');
      await ctx.page.getByRole('button', { name: `${work.name} 지금 실행`, exact: true }).click();
      await expect.poll(async () => (await ctx!.page.evaluate(() => window.ax.getState())).executions[0]?.status,
        { timeout: 15_000 }).toBe('success');
      await ctx.page.getByRole('button', { name: '계산 결과 보기', exact: true }).click();
      await expect(ctx.page.getByRole('region', { name: '계산 결과', exact: true })).toContainText('600', { timeout: 15_000 });
      const executed = await ctx.page.evaluate(() => window.ax.getState());
      expect(executed.executions).toHaveLength(1);
      expect(executed.executions[0]).toMatchObject({ workflowId: work.id, status: 'success', triggerType: 'manual' });
      expect(executed.executions[0]!.hasOutput).toBe(true);
      expect(executed.executions[0]).not.toHaveProperty('output');
      const result = await ctx.page.evaluate(id => window.ax.getExecutionOutput(id), executed.executions[0]!.id);
      expect(result.fields.map(field => field.valueJson)).toContain('600');
      for (const size of [{ width: 1280, height: 800, dark: false }, { width: 960, height: 720, dark: true }]) {
        await ctx.page.setViewportSize(size);
        if (size.dark) await ctx.page.getByRole('checkbox', { name: '다크 모드로 전환', exact: true }).check();
        const outputRegion = ctx.page.getByRole('region', { name: '계산 결과', exact: true });
        const contrast = await outputRegion.locator('pre').first().evaluate(element => {
          const luminance = (color: string) => {
            const channels = color.match(/[\d.]+/g)!.slice(0, 3).map(Number).map(value => {
              const c = value / 255;
              return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
            });
            return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
          };
          const foreground = luminance(getComputedStyle(element).color);
          const background = luminance(getComputedStyle(element.closest('.timeline-body')!).backgroundColor);
          return (Math.max(foreground, background) + 0.05) / (Math.min(foreground, background) + 0.05);
        });
        expect(contrast).toBeGreaterThanOrEqual(4.5);
        expect(await outputRegion.evaluate(element => element.getBoundingClientRect().right <= window.innerWidth)).toBe(true);
        await outputRegion.locator('summary').first().focus();
        await ctx.page.keyboard.press('Enter');
        await expect(outputRegion.locator('pre').first()).toBeHidden();
        await ctx.page.keyboard.press('Enter');
        await expect(outputRegion.locator('pre').first()).toBeVisible();
        await ctx.page.screenshot({ path: join(ctx.artifactDir, `calculated-results-${size.dark ? 'dark' : 'light'}.png`), fullPage: true });
      }
      await closeDesktop(ctx); ctx = undefined;

      ctx = await launchDesktop({ ...options, scenarioId: 'discovery-execution-reopen' });
      await ctx.page.locator('.workspace-sidebar-tab', { hasText: '활동' }).click();
      await ctx.page.getByRole('button', { name: '계산 결과 보기', exact: true }).click();
      await expect(ctx.page.getByRole('region', { name: '계산 결과', exact: true })).toContainText('600');
      writeFileSync(source, 'renamed_amount\n900\n');
      await ctx.page.locator('.workspace-sidebar-tab', { hasText: '업무' }).click();
      await ctx.page.getByRole('button', { name: `${work.name} 지금 실행`, exact: true }).click();
      await expect.poll(async () => (await ctx!.page.evaluate(() => window.ax.getState())).executions
        .filter(entry => entry.status === 'failed').length).toBe(1);
      const final = await ctx.page.evaluate(() => window.ax.getState());
      const failed = final.executions.find(entry => entry.status === 'failed')!;
      expect(failed.errorCode).toBe('input_schema_drift');
      expect(failed.hasOutput).toBe(false);
      // Only the previous successful execution has an output section.
      await expect(ctx.page.getByRole('region', { name: '계산 결과', exact: true })).toHaveCount(1);
    } finally {
      if (ctx) await closeDesktop(ctx);
      rmSync(root, { recursive: true, force: true });
    }
  });
}
