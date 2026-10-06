import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, isAbsolute, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, expect, test } from '@playwright/test';
import { ArtifactStore, buildAxDataPaths, createDatabaseAsync, ensureAxDataLayout, WorkflowStore } from '@ax-studio/core';
import * as XLSX from 'xlsx';
import { fixtureRuntime, isolatedFixtureEnv } from '../lib/isolated-fixture-env.mjs';

const require = createRequire(import.meta.url);
const electronExecutable = require('electron') as string;
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const userlikeRunsRoot = join(repoRoot, 'test/userlike-planner/runs');
const mimeType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
const runtimeCleanups = new Set<() => void>();
test.afterEach(() => {
  for (const cleanup of runtimeCleanups) cleanup();
  runtimeCleanups.clear();
});

function isWithin(parent: string, candidate: string): boolean {
  const path = relative(parent, candidate);
  return !isAbsolute(path) && path !== '..' && !path.startsWith('..' + sep);
}

function readDataSheet(path: string): unknown[][] {
  const workbook = XLSX.read(readFileSync(path), { type: 'buffer' });
  const sheet = workbook.Sheets.Data;
  assert.ok(sheet, 'exported workbook must contain the Data worksheet');
  return XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null }) as unknown[][];
}

test('scripted order export result card downloads and saves XLSX through renderer IPC', async () => {
  test.setTimeout(300_000);
  const runId = 'artifact-actions-' + Date.now();
  const artifactDir = join(repoRoot, 'test/product-qa/runs', runId);
  const runtime = fixtureRuntime(artifactDir);
  runtimeCleanups.add(runtime.cleanup);
  const screenshotsDir = join(artifactDir, 'screenshots');
  const tempDir = join(runtime.root, '.temp');
  const dataRoot = join(artifactDir, 'data');
  const userDataDir = join(runtime.root, 'electron-user-data');
  const isolatedLocalAppData = join(artifactDir, 'local-appdata');
  const isolatedRoamingAppData = join(artifactDir, 'roaming-appdata');
  for (const path of [screenshotsDir, tempDir, dataRoot, userDataDir, isolatedLocalAppData, isolatedRoamingAppData]) {
    mkdirSync(path, { recursive: true });
  }

  const safeFixtureEnv = isolatedFixtureEnv(runtime.root, {
    homeDir: userDataDir, tempDir, localAppData: isolatedLocalAppData, appData: isolatedRoamingAppData,
  });

  const scriptedOutput = execFileSync(process.execPath, [
    join(repoRoot, 'test/userlike-planner/run-core.mjs'),
    '--scripted',
    '--steps',
    '4',
  ], {
    cwd: repoRoot,
    env: safeFixtureEnv,
    encoding: 'utf8',
    timeout: 120_000,
  });
  const reportLine = scriptedOutput.split(/\r?\n/).find((line) => line.startsWith('REPORT '));
  assert.ok(reportLine, 'scripted planner run must emit a report path');
  const scriptedReportPath = reportLine.slice('REPORT '.length).trim();
  assert.ok(isWithin(userlikeRunsRoot, scriptedReportPath), 'scripted report must stay under the repository fixture runs');
  const scripted = JSON.parse(readFileSync(scriptedReportPath, 'utf8')) as {
    mode: string;
    fakeOutboxCount: number;
    results: Array<{
      prompt: string;
      verified: boolean;
      generativeCalls: number;
      http: number;
      ids?: number[];
      rows?: Array<Record<string, unknown>>;
      reply?: string;
      presentations?: Array<{ title: string; inputs: unknown[]; actions: unknown[]; blocks: unknown[] }>;
      executionStatus?: string;
      exportedFiles?: string[];
      exportedMatrix?: unknown[][];
    }>;
  };
  assert.equal(scripted.mode, 'scripted-fixture-not-language-evaluation');
  assert.equal(scripted.fakeOutboxCount, 0);
  assert.equal(scripted.results.length, 4);
  assert.ok(scripted.results.every((result) => result.verified && result.generativeCalls === 0 && result.http === 0));
  assert.deepEqual(scripted.results[1]?.ids, [2, 3, 4, 1], 'price sort must be ascending');
  assert.deepEqual(scripted.results[2]?.ids, [3, 4, 1], 'cancelled order must be excluded');
  const execution = scripted.results[3]!;
  assert.equal(execution.executionStatus, 'success');
  assert.equal(execution.presentations?.length, 1);
  const plan = execution.presentations![0]!;
  assert.equal(plan.inputs.length, 0, 'review plan must not contain editable inputs');
  assert.equal(plan.actions.length, 0, 'review plan must not contain execution controls');
  const sourceXlsx = execution.exportedFiles?.[0];
  assert.ok(sourceXlsx && existsSync(sourceXlsx), 'scripted execution must produce its XLSX');
  assert.ok(isWithin(userlikeRunsRoot, sourceXlsx), 'scripted XLSX must stay under the repository fixture runs');
  const expectedMatrix = [
    ['id', 'product', 'price', 'status'],
    ...scripted.results[2]!.rows!.map((row) => [row.id, row.product, row.price, row.status]),
  ];
  assert.deepEqual(execution.exportedMatrix, expectedMatrix);
  assert.deepEqual(readDataSheet(sourceXlsx), expectedMatrix);

  const stored = new ArtifactStore(join(dataRoot, 'generated', 'reports')).putBytes(
    readFileSync(sourceXlsx),
    { fileName: 'table.xlsx', mimeType },
  );

  // Execution results are host-authored: a renderer-saved transcript cannot mint one (the host
  // drops results it never recorded). Seed the conversation and its result through the host
  // store, exactly like a finished run publishes it, before the app opens the database.
  const transcript = [
    { role: 'user' as const, content: scripted.results[0]!.prompt },
    { role: 'assistant' as const, content: scripted.results[0]!.reply! },
    { role: 'user' as const, content: scripted.results[1]!.prompt },
    { role: 'assistant' as const, content: scripted.results[1]!.reply! },
    { role: 'user' as const, content: scripted.results[2]!.prompt },
    { role: 'assistant' as const, content: scripted.results[2]!.reply! },
    { role: 'user' as const, content: execution.prompt },
    { role: 'assistant' as const, content: execution.reply!, presentations: [plan] },
  ];
  const dataPaths = buildAxDataPaths(dataRoot);
  ensureAxDataLayout(dataPaths);
  const seedDb = await createDatabaseAsync(dataPaths.database);
  const seedStore = new WorkflowStore(seedDb);
  const session = seedStore.saveWorkspaceChat({ messages: transcript });
  seedStore.upsertWorkspaceChatExecutionResult(session.id, {
    role: 'assistant',
    content: 'Scripted order export completed.',
    kind: 'execution_result',
    executionId: 'qa-scripted-export-' + Date.now(),
    executionStatus: 'success',
    generatedSpreadsheet: { artifactId: stored.id, fileName: stored.fileName, size: stored.size, mimeType },
  });
  seedDb.close?.();

  const mainEntry = join(repoRoot, 'apps/desktop/out/main/index.js');
  const env = {
    ...safeFixtureEnv,
    AX_DATA_ROOT: dataRoot,
    AX_PRODUCT_QA: '1',
    AX_PRODUCT_QA_RUN_ID: runId,
    AX_E2E: '1',
    AX_E2E_FAKE_AGENT: '1',
    AX_E2E_DOCUMENT_ENGINE: 'mock',
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  };
  const app = await electron.launch({
    executablePath: electronExecutable,
    chromiumSandbox: true,
    args: [mainEntry, '--user-data-dir=' + userDataDir],
    cwd: repoRoot,
    env,
    timeout: 120_000,
  });
  try {
    expect(await app.evaluate(({ app }) => ['no-sandbox', 'disable-setuid-sandbox', 'disable-namespace-sandbox']
      .filter((flag) => app.commandLine.hasSwitch(flag)))).toEqual([]);
    const page = await app.firstWindow({ timeout: 120_000 });
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(error.message));
    let screenshots: string[] = [];
    let saveCalls = 0;
    let folderCalls = 0;
    const downloadPath = join(artifactDir, 'downloads', 'table.xlsx');
    const saveFolder = join(artifactDir, 'selected-folder');
    const folderSavedPath = join(saveFolder, 'table.xlsx');
    const canceledDownloadPath = join(artifactDir, 'cancelled-download.xlsx');
    const canceledFolderPath = join(saveFolder, 'cancelled-folder-output.xlsx');
    mkdirSync(dirname(downloadPath), { recursive: true });
    mkdirSync(saveFolder, { recursive: true });

    await page.waitForLoadState('domcontentloaded');
    await page.getByRole('button', { name: '새 대화', exact: true }).waitFor({ state: 'visible', timeout: 60_000 });

    await app.evaluate(({ dialog }: any) => {
      const state = {
        saveCalls: [] as Array<{ defaultPath?: string; filters?: unknown }>,
        folderCalls: [] as Array<{ title?: string; properties?: unknown }>,
        saveResponses: [] as Array<{ canceled: boolean; filePath?: string; delayMs?: number }>,
        folderResponses: [] as Array<{ canceled: boolean; filePath?: string }>,
      };
      Object.defineProperty(globalThis, '__axArtifactDialogFixture', {
        configurable: true,
        value: state,
      });
      dialog.showSaveDialog = async (options: any) => {
        const fixture = (globalThis as any).__axArtifactDialogFixture;
        fixture.saveCalls.push({ defaultPath: options.defaultPath, filters: options.filters });
        const response = fixture.saveResponses.shift();
        if (!response) throw new Error('No scripted Save As dialog response');
        if (response.delayMs) await new Promise((resolve) => setTimeout(resolve, response.delayMs));
        return {
          canceled: response.canceled,
          ...(response.filePath ? { filePath: response.filePath } : {}),
        };
      };
      dialog.showOpenDialog = async (options: any) => {
        const fixture = (globalThis as any).__axArtifactDialogFixture;
        fixture.folderCalls.push({ title: options.title, properties: options.properties });
        const response = fixture.folderResponses.shift();
        if (!response) throw new Error('No scripted folder dialog response');
        return {
          canceled: response.canceled,
          filePaths: response.filePath ? [response.filePath] : [],
        };
      };
    });

    const sessionButton = page.getByRole('button', { name: session.title, exact: true });
    await expect(sessionButton).toBeVisible({ timeout: 15_000 });
    await sessionButton.click();

    const planCard = page.locator('.ax-workspace-presentation-list').filter({ hasText: plan.title }).last();
    await expect(planCard).toBeVisible();
    await expect(planCard.getByRole('button')).toHaveCount(0);
    await expect(planCard.locator('input, select, textarea')).toHaveCount(0);
    const planScreenshot = join(screenshotsDir, 'scripted-read-only-plan-card.png');
    await planCard.screenshot({ path: planScreenshot });
    screenshots.push(planScreenshot);

    const resultCard = page.locator('.ax-workspace-generated-pdf');
    await expect(resultCard).toBeVisible();
    await expect(resultCard).toContainText('table.xlsx');
    const resultScreenshot = join(screenshotsDir, 'execution-result-card-before-save.png');
    await resultCard.screenshot({ path: resultScreenshot });
    screenshots.push(resultScreenshot);

    const downloadButton = resultCard.locator('.ax-workspace-generated-pdf-button--primary');
    const folderButton = resultCard.locator('.ax-workspace-generated-pdf-button').nth(1);
    await expect(downloadButton).toBeEnabled();
    await expect(folderButton).toBeEnabled();

    await app.evaluate(({ }: any, response: any) => {
      (globalThis as any).__axArtifactDialogFixture.saveResponses.push(response);
    }, { canceled: true });
    await downloadButton.click();
    await expect(downloadButton).toBeEnabled();
    await expect(downloadButton).toHaveText('다운로드');
    await expect(resultCard.getByRole('alert')).toHaveCount(0);
    expect(existsSync(canceledDownloadPath)).toBe(false);
    saveCalls = await app.evaluate(({ }: any) => (globalThis as any).__axArtifactDialogFixture.saveCalls.length);
    expect(saveCalls).toBe(1);

    await app.evaluate(({ }: any, response: any) => {
      (globalThis as any).__axArtifactDialogFixture.saveResponses.push(response);
    }, { canceled: false, filePath: downloadPath, delayMs: 700 });
    await downloadButton.click();
    await expect(downloadButton).toBeDisabled();
    const box = await downloadButton.boundingBox();
    assert.ok(box, 'download button must have a visible renderer position while pending');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await expect(downloadButton).toHaveText('다운로드됨', { timeout: 10_000 });
    saveCalls = await app.evaluate(({ }: any) => (globalThis as any).__axArtifactDialogFixture.saveCalls.length);
    expect(saveCalls).toBe(2);
    expect(existsSync(downloadPath)).toBe(true);
    const downloadedBytes = readFileSync(downloadPath);
    expect(downloadedBytes.equals(readFileSync(sourceXlsx))).toBe(true);
    expect(readDataSheet(downloadPath)).toEqual(expectedMatrix);

    await app.evaluate(({ }: any, response: any) => {
      (globalThis as any).__axArtifactDialogFixture.saveResponses.push(response);
    }, { canceled: false, filePath: downloadPath });
    await downloadButton.click();
    await expect(resultCard.getByRole('alert')).toBeVisible();
    await expect(downloadButton).toBeEnabled();
    expect(readFileSync(downloadPath).equals(downloadedBytes)).toBe(true);
    saveCalls = await app.evaluate(({ }: any) => (globalThis as any).__axArtifactDialogFixture.saveCalls.length);
    expect(saveCalls).toBe(3);

    await app.evaluate(({ }: any, response: any) => {
      (globalThis as any).__axArtifactDialogFixture.folderResponses.push(response);
    }, { canceled: true });
    await folderButton.click();
    await expect(folderButton).toBeEnabled();
    await expect(folderButton).toHaveText('지정 폴더에 저장');
    await expect(resultCard.getByRole('alert')).toHaveCount(0);
    expect(existsSync(canceledFolderPath)).toBe(false);
    folderCalls = await app.evaluate(({ }: any) => (globalThis as any).__axArtifactDialogFixture.folderCalls.length);
    expect(folderCalls).toBe(1);

    await app.evaluate(({ }: any, response: any) => {
      (globalThis as any).__axArtifactDialogFixture.folderResponses.push(response);
    }, { canceled: false, filePath: saveFolder });
    await folderButton.click();
    await expect(folderButton).toHaveText('폴더에 저장됨');
    expect(existsSync(folderSavedPath)).toBe(true);
    const folderBytes = readFileSync(folderSavedPath);
    expect(folderBytes.equals(readFileSync(sourceXlsx))).toBe(true);
    expect(readDataSheet(folderSavedPath)).toEqual(expectedMatrix);

    const savedScreenshot = join(screenshotsDir, 'execution-result-card-folder-saved.png');
    await resultCard.screenshot({ path: savedScreenshot });
    screenshots.push(savedScreenshot);

    await app.evaluate(({ }: any, response: any) => {
      (globalThis as any).__axArtifactDialogFixture.folderResponses.push(response);
    }, { canceled: false, filePath: saveFolder });
    await folderButton.click();
    await expect(resultCard.getByRole('alert')).toBeVisible();
    await expect(folderButton).toBeEnabled();
    expect(readFileSync(folderSavedPath).equals(folderBytes)).toBe(true);
    folderCalls = await app.evaluate(({ }: any) => (globalThis as any).__axArtifactDialogFixture.folderCalls.length);
    expect(folderCalls).toBe(3);
    expect(pageErrors).toEqual([]);

    writeFileSync(join(artifactDir, 'summary.json'), JSON.stringify({
      mode: 'scripted fixture plus deterministic Electron renderer',
      scriptedReportPath,
      sourceXlsx,
      dataRoot,
      resultIds: scripted.results[0]?.ids,
      sortedIds: scripted.results[1]?.ids,
      cancelledExcludedIds: scripted.results[2]?.ids,
      exportedRows: expectedMatrix,
      planCard: { title: plan.title, inputs: plan.inputs.length, actions: plan.actions.length, readOnly: true },
      rendererIpc: {
        downloadDialogInvocations: saveCalls,
        folderDialogInvocations: folderCalls,
        downloadCanceled: true,
        folderCanceled: true,
        rapidRepeatClickMadeOneCall: true,
        samePathOverwritePrevented: true,
      },
      dialogs: 'main-process responses were injected as test fixtures; native Windows dialogs were not exercised',
      providerApiCalls: 0,
      externalSends: 0,
      screenshots,
    }, null, 2), 'utf8');
  } finally {
    await app.close();
  }
});
