import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute, sep } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';
import { sendMessage } from '../lib/ui.js';
import { caseById } from '../../report-generation-e2e/cases.mjs';
import {
  createPdfPair,
  pythonPath,
  startOrdersServer,
} from '../../report-generation-e2e/fixtures.mjs';
import { extractPdfText, verifyPdf } from '../../report-generation-e2e/run.mjs';

const require = createRequire(import.meta.url);
const electronExecutable = require('electron') as string;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const systemPython = 'C:\\Users\\plosind\\AppData\\Local\\Programs\\Python\\Python314\\python.exe';
const benchmarkCase = caseById('multi-page-table-template');
assert.ok(benchmarkCase, 'multi-page report benchmark case must exist');

function isWithin(parent: string, candidate: string): boolean {
  const relativePath = relative(parent, candidate);
  return !isAbsolute(relativePath) && relativePath !== '..' && !relativePath.startsWith('..' + sep);
}

test('Electron report.generate recovers from a missing Python dependency and fills a two-page PDF', async () => {
  test.setTimeout(360_000);
  const runId = 'report-generation-ui-' + Date.now();
  const artifactDir = join(repoRoot, 'test', 'product-qa', 'runs', runId);
  const screenshotsDir = join(artifactDir, 'screenshots');
  const dataRoot = join(artifactDir, 'ax-data');
  const userDataDir = join(artifactDir, 'user-data');
  const tempDir = join(artifactDir, 'temp');
  const localAppData = join(artifactDir, 'local-appdata');
  const roamingAppData = join(artifactDir, 'roaming-appdata');
  const fixtureRoot = resolve(repoRoot, 'test', 'fixtures');
  const sourceFixtureRoot = resolve(fixtureRoot, '.report-generation-ui-' + runId);
  const inputDir = join(sourceFixtureRoot, 'input');
  const downloadedPath = join(artifactDir, 'download', 'monthly-customer-report.pdf');
  const savedFolder = join(artifactDir, 'saved-folder');
  const savedPath = join(savedFolder, 'monthly_customer_report_2026-09.pdf');
  for (const directory of [screenshotsDir, dataRoot, userDataDir, tempDir, localAppData, roamingAppData, dirname(downloadedPath), savedFolder]) {
    mkdirSync(directory, { recursive: true });
  }
  assert.ok(isWithin(fixtureRoot, sourceFixtureRoot), 'generated PDF inputs must stay under the E2E fixture root');

  const enginePaths = await import(pathToFileURL(
    join(repoRoot, 'packages', 'core', 'dist', 'documents', 'read', 'engine-client', 'paths.js'),
  ).href) as { defaultPythonPath(): string };
  const existingOverride = process.env.AX_DOCUMENT_ENGINE_PYTHON;
  delete process.env.AX_DOCUMENT_ENGINE_PYTHON;
  const selectedProjectPython = enginePaths.defaultPythonPath();
  if (existingOverride !== undefined) process.env.AX_DOCUMENT_ENGINE_PYTHON = existingOverride;
  expect(selectedProjectPython.replaceAll('\\', '/')).toContain('/packages/document-engine/.venv/Scripts/python.exe');

  const pdfPair = createPdfPair(inputDir, benchmarkCase);
  const ordersServer = await startOrdersServer(benchmarkCase);
  const mainEntry = join(repoRoot, 'apps', 'desktop', 'out', 'main', 'index.js');
  const systemRoot = process.env.SystemRoot ?? 'C:\\Windows';
  const baseEnv: Record<string, string> = {
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
    AX_PRODUCT_QA_RUN_ID: runId,
    AX_E2E: '1',
    AX_E2E_FAKE_AGENT: '1',
    AX_E2E_AGENT_DELAY_MS: '0',
    AX_E2E_DOCUMENT_ENGINE: 'mock',
    AX_E2E_REPORT_PLANNER: 'benchmark',
    AX_E2E_REPORT_CASE: benchmarkCase.id,
    AX_E2E_REPORT_HTTP_BASE_URL: ordersServer.baseUrl,
  };

  const launch = async (badPythonOverride: boolean) => {
    const env = { ...baseEnv };
    if (badPythonOverride) env.AX_DOCUMENT_ENGINE_PYTHON = systemPython;
    const app = await electron.launch({
      executablePath: electronExecutable,
      args: [mainEntry, '--user-data-dir=' + userDataDir],
      cwd: repoRoot,
      env,
      timeout: 120_000,
    });
    const page = await app.firstWindow({ timeout: 120_000 });
    await page.waitForLoadState('domcontentloaded');
    await page.locator('.workspace-sources-add').waitFor({ state: 'visible', timeout: 60_000 });
    return { app, page };
  };

  let runningApp: Awaited<ReturnType<typeof launch>> | undefined;
  let failureText = '';
  let failedScreenshot = '';
  let successScreenshot = '';
  let failedSelection: unknown;
  let recoveredSelection: unknown;
  let reportPath = '';
  let outputText = '';
  let verification: ReturnType<typeof verifyPdf> | undefined;
  let renderedPages: string[] = [];
  let sessionTitle = '';

  try {
    runningApp = await launch(true);
    const first = runningApp;
    const attach = async (path: string) => {
      await first.page.evaluate(async (sourcePath) => {
        const api = (window as any).ax;
        if (!api?.e2eSetWorkspaceSourcePath) throw new Error('E2E source-path fixture unavailable');
        await api.e2eSetWorkspaceSourcePath(sourcePath);
      }, path);
      await first.page.locator('.workspace-sources-add').click();
    };
    await attach(pdfPair.templatePath);
    await expect(first.page.locator('.workspace-source-item--ready').filter({ hasText: 'template.pdf' }))
      .toBeVisible({ timeout: 45_000 });
    await attach(pdfPair.examplePath);
    await expect(first.page.locator('.workspace-source-item--ready').filter({ hasText: 'example.pdf' }))
      .toBeVisible({ timeout: 45_000 });

    await sendMessage(first.page, '__e2e:report-generate__');
    const failedCard = first.page.locator('.ax-workspace-run-card--failed').last();
    await expect(failedCard).toBeVisible({ timeout: 120_000 });
    failureText = await failedCard.innerText();
    expect(failureText).toContain('AX_DOCUMENT_ENGINE_PYTHON');
    expect(failureText).toContain('document-engine:setup');
    failedScreenshot = join(screenshotsDir, 'report-generation-python-failure.png');
    await first.page.screenshot({ path: failedScreenshot, fullPage: true });

    failedSelection = await first.app.evaluate(() =>
      (globalThis as any).__axE2EReportRuntimeSelection?.runs?.at(-1),
    );
    expect(failedSelection).toMatchObject({ phase: 'failure', pythonPath: systemPython });
    const sessions = await first.page.evaluate(async () => (window as any).ax.listChatSessions());
    const session = sessions.find((item: { sourceCount?: number }) => (item.sourceCount ?? 0) >= 2) ?? sessions[0];
    assert.ok(session?.title, 'failed report session must persist for retry');
    sessionTitle = session.title;
    await first.app.evaluate(() => (globalThis as any).__axE2EReportCleanup?.());
    await first.app.close();
    runningApp = undefined;

    runningApp = await launch(false);
    const recovered = runningApp;
    const sessionRow = recovered.page.locator('.sidebar-session-item').filter({ hasText: sessionTitle }).first();
    await expect(sessionRow).toBeVisible({ timeout: 30_000 });
    await sessionRow.click();
    await expect(recovered.page.locator('.ax-workspace-run-card--failed').first()).toBeVisible();
    await sendMessage(recovered.page, '__e2e:report-retry__');

    const generatedPdf = recovered.page.locator('.ax-workspace-generated-pdf').last();
    await expect(generatedPdf).toBeVisible({ timeout: 180_000 });
    const resultCard = recovered.page.locator('.ax-workspace-run-card').filter({ has: generatedPdf }).last();
    await expect(resultCard).toContainText('.pdf');
    successScreenshot = join(screenshotsDir, 'report-generation-two-page-result.png');
    await recovered.page.screenshot({ path: successScreenshot, fullPage: true });

    recoveredSelection = await recovered.app.evaluate(() =>
      (globalThis as any).__axE2EReportRuntimeSelection?.runs?.at(-1),
    );
    expect(recoveredSelection).toMatchObject({ phase: 'retry', pythonPath: selectedProjectPython, override: null });

    await recovered.app.evaluate(({ dialog }: any, paths: { download: string; folder: string }) => {
      const fixture = { savePath: paths.download, folderPath: paths.folder };
      Object.defineProperty(globalThis, '__axReportSaveDialogFixture', { configurable: true, value: fixture });
      dialog.showSaveDialog = async () => ({
        canceled: false,
        filePath: (globalThis as any).__axReportSaveDialogFixture.savePath,
      });
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [(globalThis as any).__axReportSaveDialogFixture.folderPath],
      });
    }, { download: downloadedPath, folder: savedFolder });

    const downloadButton = generatedPdf.locator('.ax-workspace-generated-pdf-button--primary');
    await downloadButton.click();
    await expect.poll(() => existsSync(downloadedPath), { timeout: 30_000 }).toBe(true);
    const folderButton = generatedPdf.locator('.ax-workspace-generated-pdf-button').nth(1);
    await folderButton.click();
    await expect.poll(() => existsSync(savedPath), { timeout: 30_000 }).toBe(true);
    assert.ok(readFileSync(downloadedPath).equals(readFileSync(savedPath)), 'download and folder save must preserve identical PDF bytes');

    reportPath = downloadedPath;
    const pdfText = extractPdfText(reportPath);
    outputText = pdfText.text;
    verification = verifyPdf(benchmarkCase, pdfText);
    expect(verification.ok).toBe(true);
    expect(verification.pageCount).toBe(2);
    expect(verification.actualRowCount).toBe(4);
    expect(verification.scalarCompleteness).toBe(1);
    expect(verification.rowCompleteness).toBe(1);

    const renderScript = "import json,sys,pymupdf; p=json.load(sys.stdin); d=pymupdf.open(p['source']); [page.get_pixmap(matrix=pymupdf.Matrix(1.7,1.7),alpha=False).save(str(p['outputDir'] + '/report-page-' + str(page.number + 1) + '.png')) for page in d]; print(json.dumps({'pageCount': d.page_count}))";
    const render = spawnSync(pythonPath, ['-c', renderScript], {
      input: JSON.stringify({ source: reportPath, outputDir: screenshotsDir }),
      encoding: 'utf8',
      windowsHide: true,
    });
    if (render.status !== 0) throw new Error('pdf_render_failed:' + (render.stderr || render.stdout || 'unknown'));
    const renderResult = JSON.parse(render.stdout) as { pageCount: number };
    expect(renderResult.pageCount).toBe(2);
    renderedPages = [1, 2].map((page) => join(screenshotsDir, 'report-page-' + page + '.png'));
    expect(renderedPages.every(existsSync)).toBe(true);
    const recoveryChatText = await recovered.page.locator('.ax-workspace-message--assistant').allTextContents();
    expect(recoveryChatText.some((text) => text.includes('E2E report_command_queued'))).toBe(true);
    expect(ordersServer.requests.length).toBeGreaterThan(0);
    expect(ordersServer.requests.every((request) => request.path === '/api/v1/orders')).toBe(true);

    writeFileSync(join(artifactDir, 'summary.json'), JSON.stringify({
      mode: 'actual Electron commandService report.generate, deterministic planner, local-only HTTP/RDB fixtures',
      reportCase: benchmarkCase.id,
      failedPythonSelection: failedSelection,
      recoveredPythonSelection: recoveredSelection,
      failureText,
      retryChatReply: 'E2E report_command_queued',
      providerApiCalls: 0,
      localHttpRequests: ordersServer.requests,
      exportedPdf: reportPath,
      savedPdf: savedPath,
      pageCount: verification.pageCount,
      verification,
      screenshots: [failedScreenshot, successScreenshot, ...renderedPages],
    }, null, 2), 'utf8');
  } finally {
    if (runningApp) {
      await runningApp.app.evaluate(() => (globalThis as any).__axE2EReportCleanup?.()).catch(() => undefined);
      await runningApp.app.close().catch(() => undefined);
    }
    await ordersServer.close();
    if (existsSync(sourceFixtureRoot)) {
      const resolvedSourceRoot = resolve(sourceFixtureRoot);
      if (!isWithin(fixtureRoot, resolvedSourceRoot) || !runId.startsWith('report-generation-ui-')) {
        throw new Error('refusing to remove a PDF fixture outside this E2E run');
      }
      rmSync(resolvedSourceRoot, { recursive: true, force: true });
    }
  }
  expect(outputText).toMatch(/[\uAC00-\uD7A3]/);
});
