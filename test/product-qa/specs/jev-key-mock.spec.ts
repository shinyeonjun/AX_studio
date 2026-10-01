import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';
import { build } from 'esbuild';

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');

// This launches only a synthetic Electron renderer. It never loads AX startup,
// credential modules, user configuration, connectors, or a network provider.
test('Jev form distinguishes registration, mocked authentication and failed retry', async () => {
  test.setTimeout(90_000);
  const runRoot = resolve(process.env.AX_JEV_MOCK_QA_DIR ?? join(repoRoot, 'test/product-qa/runs/jev-key-mock-' + Date.now()));
  const sourceRoot = resolve(process.env.AX_JEV_MOCK_SOURCE_ROOT ?? repoRoot);
  mkdirSync(runRoot, { recursive: true });
  const form = join(sourceRoot, 'apps/desktop/src/features/settings/ui/ai/JevDecisionPlaneForm.tsx');
  const renderer = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { JevDecisionPlaneForm } from ${JSON.stringify(form)};
    window.__jevQa = { mode: 'success', requests: [] };
    window.ax = {
      async getJevDecisionConfig() { return { enabled: true, model: 'mock-jev', baseURL: 'https://fixture.invalid', apiKeyConfigured: true, apiKeyMasked: 'synthetic-***' }; },
      async testJevDecisionApi(request) {
        window.__jevQa.requests.push(request);
        if (request.apiKey && !/^[A-Za-z0-9_-]+$/.test(request.apiKey)) throw new Error('유효한 ASCII API 키를 입력하세요.');
        if (window.__jevQa.mode === 'failure') throw new Error('synthetic authentication failure');
        return { saved: Boolean(request.apiKey), masked: 'synthetic-***', model: 'mock-jev' };
      },
    };
    createRoot(document.getElementById('root')).render(<JevDecisionPlaneForm onRefresh={async () => {}} />);
  `;
  await build({ absWorkingDir: sourceRoot, stdin: { contents: renderer, resolveDir: sourceRoot, sourcefile: 'jev-mock-ui.tsx', loader: 'tsx' },
    bundle: true, jsx: 'automatic', platform: 'browser', format: 'iife', target: 'es2022', outfile: join(runRoot, 'renderer.js') });
  writeFileSync(join(runRoot, 'index.html'), '<!doctype html><meta charset="UTF-8"><div id="root"></div><script src="renderer.js"></script>');
  writeFileSync(join(runRoot, 'main.cjs'), `
    const { app, BrowserWindow } = require('electron');
    app.whenReady().then(() => {
      const win = new BrowserWindow({ show: false });
      win.loadFile(${JSON.stringify(join(runRoot, 'index.html'))});
    });
  `);
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  const app = await electron.launch({ executablePath: require('electron') as string,
    args: [join(runRoot, 'main.cjs'), '--user-data-dir=' + join(runRoot, 'user-data')], cwd: runRoot,
    env: { SYSTEMROOT: systemRoot, WINDIR: systemRoot, PATH: join(systemRoot, 'System32'),
      USERPROFILE: runRoot, APPDATA: join(runRoot, 'roaming'), LOCALAPPDATA: join(runRoot, 'local'), TEMP: runRoot, TMP: runRoot } });
  try {
    const page = await app.firstWindow();
    const badge = page.locator('.connection-badge');
    await expect(badge).toHaveText('키 등록됨 · 인증 미확인');
    await expect(badge).not.toHaveClass(/connected/);
    await page.locator('#jev-api-key').fill(' 새로운-synthetic-key ');
    await page.getByRole('button', { name: 'API 연결 테스트' }).click();
    await expect(page.locator('.connection-form-message')).toHaveText('유효한 ASCII API 키를 입력하세요.');
    expect(await page.evaluate(() => (window as any).__jevQa.requests[0].apiKey)).toBe(' 새로운-synthetic-key ');
    await expect(badge).toHaveText('키 등록됨 · 인증 미확인');
    await page.locator('#jev-api-key').fill('synthetic-key');
    await page.getByRole('button', { name: 'API 연결 테스트' }).click();
    await expect(badge).toHaveText('인증 확인됨');
    await page.evaluate(() => { (window as any).__jevQa.mode = 'failure'; });
    await page.getByRole('button', { name: 'API 연결 테스트' }).click();
    await expect(page.locator('.connection-form-message')).toHaveText('synthetic authentication failure');
    await expect(badge).toHaveText('키 등록됨 · 인증 미확인');
    await expect(badge).not.toHaveClass(/connected/);
    writeFileSync(join(runRoot, 'result.json'), JSON.stringify({ status: 'passed', mode: 'mock-renderer-only', liveApiRequests: 0,
      checked: ['registered badge', 'raw invalid draft', 'mock authentication', 'failed retry clears authentication'] }, null, 2));
  } finally {
    await app.close();
  }
});
