import { expect, test } from '@playwright/test';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { closeDesktop, launchDesktop, tempRunId, type DesktopContext } from '../lib/desktop-app.js';
import { openSettingsLink, openSidebarTab } from '../lib/ui.js';

if (process.env.AX_PRODUCT_QA_MODE === 'deterministic' && !process.env.AX_PRODUCT_QA_PRINT) {
  test('Windows Gmail setup imports an encrypted client, survives restart and recovers corruption without login', async () => {
    test.skip(process.platform !== 'win32', 'Windows OS credential acceptance');
    const root = mkdtempSync(join(tmpdir(), 'ax-gmail-setup-'));
    const dataRoot = join(root, 'profile');
    const file = join(root, 'desktop-client.json');
    const client = { client_id: 'isolated-client.apps.googleusercontent.com', client_secret: 'isolated-non-production-secret' };
    writeFileSync(file, JSON.stringify({ installed: client }));
    const options = { mode: 'deterministic' as const, realEngines: true, dataRoot,
      runId: process.env.AX_PRODUCT_QA_RUN_ID ?? tempRunId(), scenarioId: 'gmail-client-setup' };
    let ctx: DesktopContext | undefined;
    const openGmail = async () => { await openSidebarTab(ctx!.page, 'settings'); await openSettingsLink(ctx!.page, 'Gmail'); };
    try {
      ctx = await launchDesktop(options);
      await ctx.app.evaluate(({ dialog }, path) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
      }, file);
      await openGmail();
      await ctx.page.getByRole('button', { name: 'OAuth 클라이언트 JSON 가져오기', exact: true }).click();
      await expect(ctx.page.getByRole('button', { name: 'Gmail 연결하기', exact: true })).toBeEnabled();
      await expect(ctx.page.getByText('OAuth 설정을 저장했습니다. 이제 Gmail을 연결해 주세요.', { exact: true })).toBeVisible();
      const stored = await ctx.page.evaluate(() => window.ax.getState());
      expect(stored.gmailOAuthCustom).toBe(true);
      expect(JSON.stringify(stored)).not.toContain(client.client_secret);
      await ctx.page.setViewportSize({ width: 960, height: 720 });
      const actions = ctx.page.locator('.gmail-client-actions');
      expect(await actions.evaluate(element => element.scrollWidth <= element.clientWidth)).toBe(true);
      await ctx.page.screenshot({ path: join(ctx.artifactDir, 'gmail-client-ready.png'), fullPage: true });
      const credentialPath = join(dataRoot, 'credentials', 'secret-google-oauth-client.cred');
      expect(readFileSync(credentialPath).includes(Buffer.from(client.client_secret))).toBe(false);
      writeFileSync(file, '{"web":{"client_id":"not-a-desktop-client"}}');
      await ctx.page.getByRole('button', { name: 'OAuth 클라이언트 JSON 가져오기', exact: true }).click();
      await expect(ctx.page.getByText('Google에서 내려받은 데스크톱 앱 OAuth 클라이언트 JSON을 선택해 주세요.', { exact: false })).toBeVisible();
      expect((await ctx.page.evaluate(() => window.ax.getState())).gmailOAuthCustom).toBe(true);
      await closeDesktop(ctx); ctx = undefined;

      ctx = await launchDesktop({ ...options, scenarioId: 'gmail-client-reopen' });
      await openGmail();
      await expect(ctx.page.getByRole('button', { name: 'Gmail 연결하기', exact: true })).toBeEnabled();
      await closeDesktop(ctx); ctx = undefined;
      writeFileSync(credentialPath, 'isolated-corrupt-encrypted-data');
      ctx = await launchDesktop({ ...options, scenarioId: 'gmail-client-corrupt' });
      await openGmail();
      await expect(ctx.page.getByRole('button', { name: 'Gmail 연결하기', exact: true })).toBeDisabled();
      await expect(ctx.page.getByText(/저장된 Gmail OAuth 설정을 읽지 못했습니다/)).toBeVisible();
      expect(readFileSync(credentialPath, 'utf8')).toBe('isolated-corrupt-encrypted-data');
      await ctx.page.getByRole('button', { name: '가져온 OAuth 설정 제거', exact: true }).click();
      await expect(ctx.page.getByRole('button', { name: '가져온 OAuth 설정 제거', exact: true })).toHaveCount(0);
    } finally {
      if (ctx) await closeDesktop(ctx);
      rmSync(root, { recursive: true, force: true });
    }
  });
}
