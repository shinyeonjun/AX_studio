import { createRequire } from 'node:module';
import { mkdirSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';
import { sendMessage } from '../lib/ui.js';

const require = createRequire(import.meta.url);
const electronExecutable = require('electron') as string;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const samplePdf = join(repoRoot, 'test/fixtures/sample.pdf');
const engineModuleUrl = pathToFileURL(join(repoRoot, 'packages/core/dist/documents/read/engine-client.js')).href;
const systemPython = 'C:\\Users\\plosind\\AppData\\Local\\Programs\\Python\\Python314\\python.exe';

test('Electron document source uses the core Python resolver and recovers after an invalid override', async () => {
  test.setTimeout(180_000);
  const runId = 'document-engine-runtime-' + Date.now();
  const artifactDir = join(repoRoot, 'test/product-qa/runs', runId);
  mkdirSync(artifactDir, { recursive: true });
  const mainEntry = join(repoRoot, 'apps/desktop/out/main/index.js');
  const resolver = await import(engineModuleUrl);
  const configuredOverride = process.env.AX_DOCUMENT_ENGINE_PYTHON;
  delete process.env.AX_DOCUMENT_ENGINE_PYTHON;
  const defaultPythonPath = resolver.defaultPythonPath();
  if (configuredOverride !== undefined) process.env.AX_DOCUMENT_ENGINE_PYTHON = configuredOverride;
  expect(defaultPythonPath.replaceAll('\\', '/')).toContain('/packages/document-engine/.venv/Scripts/python.exe');

  const launch = async (profile: string, pythonOverride?: string) => {
    const profileRoot = join(artifactDir, profile);
    const tempDir = join(profileRoot, 'temp');
    const userDataDir = join(profileRoot, 'user-data');
    const localAppData = join(profileRoot, 'local-appdata');
    const roamingAppData = join(profileRoot, 'roaming-appdata');
    const dataRoot = join(profileRoot, 'ax-data');
    for (const path of [tempDir, userDataDir, localAppData, roamingAppData, dataRoot]) mkdirSync(path, { recursive: true });
    // Keep OS utilities available but remove Python from PATH to exercise project-venv resolution.
    const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
    const env: Record<string, string> = {
      PATH: [join(systemRoot, 'System32'), systemRoot].join(';'),
      SYSTEMROOT: systemRoot,
      WINDIR: systemRoot,
      TEMP: tempDir,
      TMP: tempDir,
      USERPROFILE: userDataDir,
      LOCALAPPDATA: localAppData,
      APPDATA: roamingAppData,
      AX_DATA_ROOT: dataRoot,
      AX_PRODUCT_QA: '1',
      AX_E2E: '1',
      AX_E2E_FAKE_AGENT: '1',
      AX_E2E_AGENT_DELAY_MS: '0',
    };
    const pythonPathProbe = spawnSync('where.exe', ['python.exe'], {
      encoding: 'utf8',
      windowsHide: true,
      env,
    });
    if (pythonPathProbe.error) throw pythonPathProbe.error;
    const pythonOnPath = pythonPathProbe.status === 0;
    expect(pythonOnPath).toBe(false);
    if (pythonOverride) env.AX_DOCUMENT_ENGINE_PYTHON = pythonOverride;
    const app = await electron.launch({
      executablePath: electronExecutable,
      args: [mainEntry, '--user-data-dir=' + userDataDir],
      cwd: repoRoot,
      env,
      timeout: 120_000,
    });
    const page = await app.firstWindow({ timeout: 120_000 });
    await page.waitForLoadState('domcontentloaded');
    const attachButton = page.locator('.workspace-sources-add');
    await expect(attachButton).toBeVisible({ timeout: 60_000 });
    return { app, page, attachButton, pythonOnPath };
  };

  let runningApp: Awaited<ReturnType<typeof launch>> | undefined;
  let failureText = '';
  let failedScreenshot = '';
  let readyScreenshot = '';
  let assistantReplyText = '';
  try {
    runningApp = await launch('bad-python', systemPython);
    const bad = runningApp;
    await bad.app.evaluate(({ dialog }: any) => {
      dialog.showOpenDialog = async () => ({ canceled: true, filePaths: [] });
    });
    await bad.attachButton.click();
    await expect(bad.attachButton).toBeEnabled();
    await expect(bad.page.locator('.ax-workspace-error')).toHaveCount(0);
    expect(await bad.page.locator('.workspace-source-item').count()).toBe(0);

    await bad.page.evaluate(async (path) => (window as any).ax.e2eSetWorkspaceSourcePath(path), samplePdf);
    await bad.attachButton.click();
    const failedSource = bad.page.locator('.workspace-source-item--failed').filter({ hasText: 'sample.pdf' });
    await expect(failedSource).toBeVisible({ timeout: 30_000 });
    failureText = await failedSource.locator('.workspace-source-error').innerText();
    expect(failureText).toContain('AX_DOCUMENT_ENGINE_PYTHON');
    expect(failureText).toContain('npm run document-engine:setup');
    await expect(bad.attachButton).toBeEnabled();
    failedScreenshot = join(artifactDir, 'python-runtime-failure.png');
    await bad.page.screenshot({ path: failedScreenshot, fullPage: true });
    await bad.app.close();
    runningApp = undefined;

    // A user retries after correcting the runtime and restarting the app; this process inherits no override.
    runningApp = await launch('project-venv', undefined);
    const good = runningApp;
    await good.page.evaluate(async (path) => (window as any).ax.e2eSetWorkspaceSourcePath(path), samplePdf);
    await good.attachButton.click();
    await expect(good.page.locator('.workspace-source-item--ready').filter({ hasText: 'sample.pdf' }))
      .toBeVisible({ timeout: 30_000 });
    await expect(good.page.locator('.ax-workspace-error')).toHaveCount(0);
    await sendMessage(good.page, '__e2e:source-read__');
    const assistantReply = good.page.locator('.ax-workspace-message--assistant').last();
    await expect(assistantReply).toContainText('E2E source_read_ok', { timeout: 20_000 });
    await expect(assistantReply).toContainText('engine=basic');
    assistantReplyText = await assistantReply.innerText();
    readyScreenshot = join(artifactDir, 'python-runtime-recovered.png');
    await good.page.screenshot({ path: readyScreenshot, fullPage: true });
    expect(await good.page.locator('.ax-workspace-error').count()).toBe(0);

    writeFileSync(join(artifactDir, 'summary.json'), JSON.stringify({
      mode: 'actual Electron main + real StdioDocumentEngineClient + fake chat agent',
      defaultPythonPath,
      pythonOnPath: good.pythonOnPath,
      invalidOverride: systemPython,
      failureText,
      recoveredPythonPath: defaultPythonPath,
      cancelDialogFixture: true,
      failedAttachWasRetryable: true,
      recoveredReadReply: assistantReplyText,
      providerApiCalls: 0,
      screenshots: [failedScreenshot, readyScreenshot],
    }, null, 2), 'utf8');
  } finally {
    if (runningApp) await runningApp.app.close();
  }
});
