import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';
import { build } from 'esbuild';
import { fixtureRuntime, isolatedFixtureEnv } from '../lib/isolated-fixture-env.mjs';

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const runtimeCleanups = new Set<() => void>();
test.afterEach(() => {
  for (const cleanup of runtimeCleanups) cleanup();
  runtimeCleanups.clear();
});

// This launches only a synthetic Electron renderer. It never loads AX startup,
// credential modules, user configuration, connectors, or a network provider.
test('Jev switch sends the key as typed, shows mocked authentication and failed retry', async () => {
  test.setTimeout(90_000);
  const runRoot = resolve(process.env.AX_JEV_MOCK_QA_DIR ?? join(repoRoot, 'test/product-qa/runs/jev-key-mock-' + Date.now()));
  const sourceRoot = resolve(process.env.AX_JEV_MOCK_SOURCE_ROOT ?? repoRoot);
  mkdirSync(runRoot, { recursive: true });
  const runtime = fixtureRuntime(runRoot);
  runtimeCleanups.add(runtime.cleanup);
  const form = join(sourceRoot, 'apps/desktop/src/features/settings/ui/ai/JevDecisionPlaneForm.tsx');
  const renderer = `
    import React from 'react';
    import { createRoot } from 'react-dom/client';
    import { JevDecisionPlaneForm } from ${JSON.stringify(form)};
    window.__jevQa = { mode: 'success', requests: [] };
    window.ax = {
      async getJevDecisionConfig() { return { enabled: true, model: 'mock-jev', baseURL: 'https://fixture.invalid', defaultBaseURL: 'https://fixture.invalid', apiKeyConfigured: true, apiKeyMasked: 'synthetic-***' }; },
      async saveJevDecisionConfig(prefs) {
        window.__jevQa.saves = (window.__jevQa.saves ?? 0) + 1;
        return { enabled: prefs.enabled, model: 'mock-jev', baseURL: 'https://fixture.invalid', defaultBaseURL: 'https://fixture.invalid', apiKeyConfigured: true, apiKeyMasked: 'synthetic-***' };
      },
      async testJevDecisionApi(request) {
        window.__jevQa.requests.push(request);
        if (request.apiKey && !/^[A-Za-z0-9_-]+$/.test(request.apiKey)) throw new Error('유효한 ASCII API 키를 입력하세요.');
        if (window.__jevQa.mode === 'failure') throw new Error('API 키가 거부됐어요. 키를 다시 확인해 주세요.');
        if (window.__jevQa.mode === 'english') throw new Error('synthetic authentication failure');
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
  const app = await electron.launch({ executablePath: require('electron') as string, chromiumSandbox: true,
    args: [join(runRoot, 'main.cjs'), '--user-data-dir=' + join(runtime.root, 'user-data')], cwd: runRoot,
    env: isolatedFixtureEnv(runtime.root, { windowsPath: 'system32' }) });
  try {
    expect(await app.evaluate(({ app }) => ['no-sandbox', 'disable-setuid-sandbox', 'disable-namespace-sandbox']
      .filter((flag) => app.commandLine.hasSwitch(flag)))).toEqual([]);
    const page = await app.firstWindow();
    const message = page.locator('.connection-form-message');
    const key = page.getByPlaceholder('Jev API 키');
    await expect(page.getByRole('switch', { name: 'Jev 요청 판단' })).toBeChecked();
    await expect(page.locator('.jev-key-current')).toContainText('등록된 키 synthetic-***');
    await page.getByRole('button', { name: '키 바꾸기' }).click();
    await key.fill(' 새로운-synthetic-key ');
    await page.getByRole('button', { name: '연결' }).click();
    await expect(message).toHaveText('유효한 ASCII API 키를 입력하세요.');
    expect(await page.evaluate(() => (window as any).__jevQa.requests[0].apiKey)).toBe(' 새로운-synthetic-key ');
    expect(await page.evaluate(() => (window as any).__jevQa.saves ?? 0)).toBe(0);
    await key.fill('synthetic-key');
    await page.getByRole('button', { name: '연결' }).click();
    await expect(message).toHaveText('연결했어요. Jev가 요청을 판단합니다.');
    expect(await page.evaluate(() => (window as any).__jevQa.saves)).toBe(1);
    await page.evaluate(() => { (window as any).__jevQa.mode = 'failure'; });
    await page.getByRole('button', { name: '키 바꾸기' }).click();
    await key.fill('synthetic-key');
    await page.getByRole('button', { name: '연결' }).click();
    await expect(message).toHaveText('API 키가 거부됐어요. 키를 다시 확인해 주세요.');
    // Untranslated English from the main process is never shown as is.
    await page.evaluate(() => { (window as any).__jevQa.mode = 'english'; });
    await page.getByRole('button', { name: '연결' }).click();
    await expect(message).toHaveText('API 키를 확인하지 못했어요. 키를 다시 확인해 주세요.');
    expect(await page.evaluate(() => (window as any).__jevQa.saves)).toBe(1);
    writeFileSync(join(runRoot, 'result.json'), JSON.stringify({ status: 'passed', mode: 'mock-renderer-only', liveApiRequests: 0,
      checked: ['registered key shown', 'raw invalid draft not saved', 'mock authentication saves', 'failed retry not saved', 'english error replaced'] }, null, 2));
  } finally {
    await app.close();
  }
});
