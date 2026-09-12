import { expect, test } from '@playwright/test';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PRODUCT_SURFACES } from '../catalog/product-surface.js';
import { coverageFor, loadScenarios } from '../lib/scenario-loader.js';
import { closeDesktop, launchDesktop, tempRunId, type DesktopContext } from '../lib/desktop-app.js';
import { runScenario } from '../lib/step-runner.js';
import { buildReport } from '../lib/metrics.js';
import { writeReport } from '../lib/reporter.js';
import type { ProductQaMode, ProductQaTier, ProductScenario, ScenarioRunResult } from '../lib/types.js';

function parseMode(): ProductQaMode {
  const mode = (process.env.AX_PRODUCT_QA_MODE ?? 'live').trim();
  return mode === 'deterministic' ? 'deterministic' : 'live';
}

function parseTier(): ProductQaTier {
  const tier = (process.env.AX_PRODUCT_QA_TIER ?? 'handwritten').trim();
  if (tier === 'smoke' || tier === 'core' || tier === 'full' || tier === 'soak' || tier === 'handwritten') {
    return tier;
  }
  return 'handwritten';
}

function parseRepeat(): number {
  const value = Number.parseInt(process.env.AX_PRODUCT_QA_REPEAT ?? '1', 10);
  return Number.isFinite(value) ? Math.max(1, Math.min(value, 500)) : 1;
}

function parseMax(tier: ProductQaTier): number {
  const value = Number.parseInt(process.env.AX_PRODUCT_QA_MAX ?? '0', 10);
  if (Number.isFinite(value) && value > 0) return value;
  if (tier === 'soak') return 10_000;
  if (tier === 'full') return 2_000;
  if (tier === 'core') return 300;
  return 50;
}

function parseFilters() {
  const ids = process.env.AX_PRODUCT_QA_SCENARIOS?.split(',').map((v) => v.trim()).filter(Boolean);
  const tags = process.env.AX_PRODUCT_QA_TAGS?.split(',').map((v) => v.trim()).filter(Boolean);
  return { ids, tags };
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const mode = parseMode();
const tier = parseTier();
const repeat = parseRepeat();
const strict = process.env.AX_PRODUCT_QA_STRICT === '1';
const filters = parseFilters();
const runId = process.env.AX_PRODUCT_QA_RUN_ID ?? tempRunId();
process.env.AX_PRODUCT_QA_RUN_ID = runId;

const scenarios = loadScenarios({
  ids: filters.ids,
  tags: filters.tags,
  mode,
  tier,
  max: parseMax(tier),
  allowSideEffects: process.env.AX_PRODUCT_QA_ALLOW_SIDE_EFFECTS === '1',
  seed: Number.parseInt(process.env.AX_PRODUCT_QA_SEED ?? '20260825', 10),
});

const printMode = process.env.AX_PRODUCT_QA_PRINT?.trim();
const allResults: ScenarioRunResult[] = [];
const allReplyLatencies: number[] = [];
const startedAt = new Date().toISOString();

function persistReport(dataRoot: string, artifactDir: string) {
  const report = buildReport({
    runId,
    mode,
    startedAt,
    finishedAt: new Date().toISOString(),
    dataRoot,
    strict,
    tier,
    scenarios: allResults,
    replyLatenciesMs: allReplyLatencies,
    coverage: coverageFor(allResults.filter((result) => result.passed)),
  });
  writeReport(report, artifactDir);
}

async function executeScenario(
  ctx: DesktopContext,
  scenario: ProductScenario,
  runIndex: number,
) {
  const { result, replyLatenciesMs } = await runScenario(ctx, scenario, runIndex, strict);
  allResults.push(result);
  allReplyLatencies.push(...replyLatenciesMs);
  persistReport(ctx.dataRoot, ctx.artifactDir);

  if (result.error && (strict || !scenario.generated)) {
    throw new Error(result.error);
  }
  const failedChecks = result.defects.filter((d) => !d.passed);
  if (strict && failedChecks.length > 0) {
    throw new Error(failedChecks.map((d) => `${d.check}: ${d.actual}`).join('; '));
  }
}

if (!printMode && mode === 'deterministic' && !filters.ids?.length && !filters.tags?.length) {
  test('slow app state loads while change notifications keep arriving', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'ax-slow-app-state-'));
    const ctx = await launchDesktop({ mode: 'deterministic', dataRoot, runId,
      scenarioId: 'slow-app-state' });
    try {
      const initialState = await ctx.page.evaluate(() => window.ax.getState());
      await ctx.app.evaluate(({ ipcMain, BrowserWindow }, state) => {
        ipcMain.removeHandler('ax:getState');
        ipcMain.handle('ax:getState', async () => {
          await new Promise((resolve) => setTimeout(resolve, 2_200));
          return state;
        });
        const events = setInterval(() => {
          for (const window of BrowserWindow.getAllWindows()) window.webContents.send('ax:state-changed');
        }, 500);
        setTimeout(() => clearInterval(events), 15_000);
      }, initialState);
      await ctx.page.reload();
      const loading = ctx.page.getByText('앱 상태를 불러오는 중…', { exact: true });
      await expect(loading).toBeVisible();
      await expect(loading).toHaveCount(0, { timeout: 6_000 });
      await ctx.page.locator('.workspace-sidebar-tab', { hasText: '활동' }).click();
      await expect(ctx.page.getByRole('heading', { name: '활동', exact: true })).toBeVisible();
    } finally {
      await closeDesktop(ctx);
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  test('slow discovery inspection still displays its result and releases busy controls', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'ax-slow-discovery-'));
    const ctx = await launchDesktop({ mode: 'deterministic', dataRoot, runId,
      scenarioId: 'slow-discovery' });
    const rendererErrors: string[] = [];
    ctx.page.on('pageerror', (error) => rendererErrors.push(error.message));
    try {
      await ctx.app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('ax:importArtifact');
        ipcMain.handle('ax:importArtifact', () => ({ ok: true, artifact: { id: 'qa-example' } }));
        ipcMain.removeHandler('ax:discoveryStart');
        ipcMain.handle('ax:discoveryStart', () => ({ status: 'ok', data: { sessionId: 'qa-slow-discovery' } }));
        ipcMain.removeHandler('ax:discoveryInspect');
        ipcMain.handle('ax:discoveryInspect', async () => {
          ipcMain.emit('qa:inspection-started');
          await new Promise((resolve) => setTimeout(resolve, 2_200));
          return { status: 'ok', data: { sessionId: 'qa-slow-discovery', status: 'needs_attention',
            revision: 1, progress: '느린 조회의 결과가 도착했습니다.', publishable: false,
            observations: [], fieldReviews: [], replaySummary: { total: 0, passed: 0, failed: 0 },
            supportedOutputFormats: ['pdf'] } };
        });
      });
      await ctx.page.getByRole('button', { name: '지난 결과물 첨부하기', exact: true }).click();
      await expect(ctx.page.locator('[data-discovery-status="needs_attention"]')).toBeVisible({ timeout: 8_000 });
      await expect(ctx.page.locator('[data-discovery-status="needs_attention"]')
        .getByRole('button', { name: '다시 시도', exact: true })).toBeEnabled({ timeout: 8_000 });
      await ctx.page.getByRole('button', { name: '새 대화', exact: true }).click();
      const started = ctx.app.evaluate(({ ipcMain }) => new Promise<void>((resolve) => {
        ipcMain.once('qa:inspection-started', () => resolve());
      }));
      await ctx.page.getByRole('button', { name: '지난 결과물 첨부하기', exact: true }).click();
      await started;
      await ctx.page.getByRole('button', { name: '새 대화', exact: true }).click();
      // The in-flight 2.2s response must not populate the new conversation.
      await ctx.page.waitForTimeout(2_500);
      await expect(ctx.page.locator('[data-discovery-status]')).toHaveCount(0);
      await expect(ctx.page.getByRole('button', { name: '지난 결과물 첨부하기', exact: true })).toBeEnabled();
      expect(rendererErrors).toEqual([]);
    } finally {
      await closeDesktop(ctx);
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  test('cyclic saved workflow preview reports an error without losing chat navigation', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'ax-cycle-preview-'));
    const ctx = await launchDesktop({ mode: 'deterministic', dataRoot, runId,
      scenarioId: 'cycle-preview' });
    const rendererErrors: string[] = [];
    ctx.page.on('pageerror', (error) => rendererErrors.push(error.message));
    try {
      await ctx.app.evaluate(({ ipcMain }) => {
        const session = { id: 'qa-cycle-chat', title: '순환 분기 확인', kind: 'workspace',
          workflowId: 'qa-cycle-work', updatedAt: new Date().toISOString(), messages: [] };
        const nodes = [['entry', 'a'], ['a', 'b'], ['b', 'a']].map(([id, target]) => ({
          id, type: 'if', thenStepIds: [target],
          condition: { op: 'eq', left: { lit: true }, right: { lit: true } },
        }));
        ipcMain.removeHandler('ax:listChatSessions');
        ipcMain.handle('ax:listChatSessions', () => [session]);
        ipcMain.removeHandler('ax:loadWorkspaceChat');
        ipcMain.handle('ax:loadWorkspaceChat', () => session);
        ipcMain.removeHandler('ax:listWorkspaceSources');
        ipcMain.handle('ax:listWorkspaceSources', () => ({ sources: [] }));
        ipcMain.removeHandler('ax:loadWorkChat');
        ipcMain.handle('ax:loadWorkChat', () => ({ title: session.title, active: false,
          state: { workflow: { name: session.title, goal: '분기 수정', triggerType: 'manual',
            assumptions: [], nodes, actions: {} } } }));
      });
      await ctx.page.reload();
      await ctx.page.getByRole('button', { name: '순환 분기 확인', exact: true }).click();
      await ctx.page.getByRole('heading', { name: '순환 분기 확인', exact: true }).waitFor();
      await ctx.page.getByRole('tab', { name: '워크플로우', exact: true }).click();
      await expect(ctx.page.getByRole('alert')).toContainText('순환', { timeout: 5_000 });
      await ctx.page.getByRole('button', { name: '새 대화', exact: true }).click();
      await expect(ctx.page.getByRole('alert')).toHaveCount(0);
      await expect(ctx.page.getByRole('tab', { name: '워크플로우', exact: true })).toBeVisible();
      expect(rendererErrors).toEqual([]);
    } finally {
      await closeDesktop(ctx);
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  test('conversation list read failure is visible and retry restores history', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'ax-chat-list-recovery-'));
    const ctx = await launchDesktop({ mode: 'deterministic', dataRoot, runId,
      scenarioId: 'chat-list-recovery' });
    const rendererErrors: string[] = [];
    ctx.page.on('pageerror', (error) => rendererErrors.push(error.message));
    try {
      await ctx.app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('ax:listChatSessions');
        ipcMain.handle('ax:listChatSessions', () => { throw new Error('대화 목록을 읽을 수 없습니다.'); });
      });
      await ctx.page.reload();
      await expect(ctx.page.getByRole('alert')).toContainText('대화 목록을 읽을 수 없습니다.', { timeout: 5_000 });
      await ctx.app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('ax:listChatSessions');
        ipcMain.handle('ax:listChatSessions', () => [{ id: 'qa-saved-conversation',
          title: '복구된 월간 보고서 대화', kind: 'workspace', updatedAt: new Date().toISOString() }]);
      });
      await ctx.page.getByRole('button', { name: '다시 시도', exact: true }).click();
      await expect(ctx.page.getByRole('button', { name: '복구된 월간 보고서 대화', exact: true })).toBeVisible();
      await expect(ctx.page.getByRole('alert')).toHaveCount(0);
      expect(rendererErrors).toEqual([]);
    } finally {
      await closeDesktop(ctx);
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  test('older conversation refresh cannot replace a newer recovered list', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'ax-chat-list-order-'));
    const ctx = await launchDesktop({ mode: 'deterministic', dataRoot, runId,
      scenarioId: 'chat-list-order' });
    try {
      await ctx.app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('ax:listChatSessions');
        ipcMain.handle('ax:listChatSessions', () => { throw new Error('대화 목록 조회를 다시 시도해 주세요.'); });
      });
      await ctx.page.reload();
      await expect(ctx.page.getByRole('alert')).toContainText('대화 목록 조회를 다시 시도해 주세요.');
      await ctx.app.evaluate(({ ipcMain }) => {
        let request = 0;
        ipcMain.removeHandler('ax:listChatSessions');
        ipcMain.handle('ax:listChatSessions', () => {
          if (++request === 1) {
            return new Promise((resolve) => {
              ipcMain.once('qa:release-old-conversation-list', () => resolve([]));
            });
          }
          return [{ id: 'qa-current-conversation', title: '최신 대화 유지', kind: 'workspace',
            updatedAt: new Date().toISOString() }];
        });
      });
      const retry = ctx.page.getByRole('button', { name: '다시 시도', exact: true });
      await retry.click();
      await retry.click();
      const currentConversation = ctx.page.getByRole('button', { name: '최신 대화 유지', exact: true });
      await expect(currentConversation).toBeVisible();
      await ctx.app.evaluate(({ ipcMain }) => { ipcMain.emit('qa:release-old-conversation-list'); });
      // Let the released IPC response and React update reach the visible sidebar.
      await ctx.page.waitForTimeout(250);
      await expect(currentConversation).toBeVisible({ timeout: 2_000 });
      await expect(ctx.page.getByRole('alert')).toHaveCount(0);
    } finally {
      await closeDesktop(ctx);
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  test('AI configuration read failure is visible and retryable', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'ax-ai-detection-recovery-'));
    const ctx = await launchDesktop({ mode: 'deterministic', dataRoot, runId,
      scenarioId: 'ai-detection-recovery' });
    const rendererErrors: string[] = [];
    ctx.page.on('pageerror', (error) => rendererErrors.push(error.message));
    try {
      await ctx.app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('ax:getAiConfig');
        ipcMain.handle('ax:getAiConfig', () => { throw new Error('AI 설정 파일을 읽을 수 없습니다.'); });
        ipcMain.removeHandler('ax:detectAiCli');
        ipcMain.handle('ax:detectAiCli', () => []);
      });
      await ctx.page.reload();
      await ctx.page.locator('.workspace-sidebar-tab', { hasText: '설정' }).click();
      await expect(ctx.page.getByRole('alert')).toHaveCount(1, { timeout: 5_000 });
      await expect(ctx.page.getByRole('alert')).toContainText('AI 설정 파일을 읽을 수 없습니다.');
      await ctx.app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('ax:getAiConfig');
        ipcMain.handle('ax:getAiConfig', () => ({ path: 'isolated-qa-config',
          providers: { gpt: { mode: 'api' } }, secrets: {} }));
      });
      await ctx.page.getByRole('button', { name: '다시 시도', exact: true }).click();
      await expect(ctx.page.getByRole('alert')).toHaveCount(0, { timeout: 5_000 });
      await ctx.page.getByRole('button', { name: 'GPT 설정', exact: true }).click();
      await expect(ctx.page.locator('#gpt-api-key')).toBeVisible();
      expect(rendererErrors).toEqual([]);
    } finally {
      await closeDesktop(ctx);
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  test('AI provider switches isolate unsaved API key drafts', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'ax-ai-form-isolation-'));
    const ctx = await launchDesktop({ mode: 'deterministic', dataRoot, runId,
      scenarioId: 'ai-provider-form-isolation' });
    const rendererErrors: string[] = [];
    ctx.page.on('pageerror', (error) => rendererErrors.push(error.message));
    try {
      await ctx.app.evaluate(({ ipcMain }) => {
        ipcMain.removeHandler('ax:getAiConfig');
        ipcMain.handle('ax:getAiConfig', () => ({
          path: 'isolated-qa-config',
          providers: { claude: { mode: 'api' }, gpt: { mode: 'api' } },
          secrets: {},
        }));
        ipcMain.removeHandler('ax:detectAiCli');
        ipcMain.handle('ax:detectAiCli', () => []);
      });
      await ctx.page.reload();
      await ctx.page.locator('.workspace-sidebar-tab', { hasText: '설정' }).click();
      await ctx.page.getByRole('button', { name: 'Claude 설정', exact: true }).click();
      await ctx.page.locator('#claude-api-key').fill('qa-claude-draft-not-a-real-key');
      await ctx.page.getByRole('button', { name: 'GPT 설정', exact: true }).click();
      await expect(ctx.page.locator('#gpt-api-key')).toHaveValue('', { timeout: 5_000 });
      await ctx.page.locator('#gpt-api-key').fill('qa-gpt-draft-not-a-real-key');
      await ctx.page.getByRole('button', { name: 'Claude 설정', exact: true }).click();
      await expect(ctx.page.locator('#claude-api-key')).toHaveValue('', { timeout: 5_000 });
      expect(rendererErrors).toEqual([]);
    } finally {
      await closeDesktop(ctx);
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });

  test('activity bulk clear reports storage failure and permits retry', async () => {
    const dataRoot = mkdtempSync(join(tmpdir(), 'ax-activity-clear-'));
    const ctx = await launchDesktop({
      mode: 'deterministic',
      dataRoot,
      runId,
      scenarioId: 'activity-clear-recovery',
    });
    const rendererErrors: string[] = [];
    ctx.page.on('pageerror', (error) => rendererErrors.push(error.message));
    ctx.page.on('dialog', (dialog) => void dialog.accept());
    try {
      const initialState = await ctx.page.evaluate(() => window.ax.getState());
      await ctx.app.evaluate(({ ipcMain }, initial) => {
        const state = {
          ...(initial && typeof initial === 'object' ? initial : {}),
          executions: [{ id: 'qa-history', status: 'success', ephemeral: true,
            startedAt: new Date().toISOString(), triggerType: 'manual' }],
        };
        let failNextClear = true;
        ipcMain.removeHandler('ax:getState');
        ipcMain.handle('ax:getState', () => state);
        ipcMain.removeHandler('ax:clearExecutions');
        ipcMain.handle('ax:clearExecutions', () => {
          if (failNextClear) {
            failNextClear = false;
            throw new Error('저장소가 잠겨 있습니다. 잠시 후 다시 시도해 주세요.');
          }
          state.executions = [];
          return { ok: true, removed: 1 };
        });
      }, initialState);
      await ctx.page.reload();
      await ctx.page.locator('.workspace-sidebar-tab', { hasText: '활동' }).click();
      const clear = ctx.page.getByRole('button', { name: '기록 모두 지우기', exact: true });
      await expect(ctx.page.getByRole('button', { name: '기록 삭제', exact: true })).toHaveCount(1);
      await clear.click();
      await expect(ctx.page.getByRole('alert')).toContainText('저장소가 잠겨 있습니다.', { timeout: 5_000 });
      await expect(clear).toBeEnabled();
      await expect(ctx.page.getByRole('button', { name: '기록 삭제', exact: true })).toHaveCount(1);
      await clear.click();
      await expect(ctx.page.getByText('아직 실행 기록이 없습니다', { exact: true })).toBeVisible();
      await expect(ctx.page.getByRole('alert')).toHaveCount(0);
      expect(rendererErrors).toEqual([]);
    } finally {
      await closeDesktop(ctx);
      rmSync(dataRoot, { recursive: true, force: true });
    }
  });
}

if (printMode) {
  test('print product-qa plan', () => {
    if (printMode === 'catalog') {
      for (const surface of PRODUCT_SURFACES) {
        console.log(
          `${surface.id}\t[${surface.productReady ? 'ready' : 'hidden'}]\t${surface.area}\t${surface.sideEffect}\t${surface.title}`,
        );
      }
      const ready = PRODUCT_SURFACES.filter((surface) => surface.productReady).length;
      console.log(`\n# ${PRODUCT_SURFACES.length} surfaces, ${ready} product-ready`);
      return;
    }
    const coverage = coverageFor(scenarios);
    const generatedCount = scenarios.filter((scenario) => scenario.generated).length;
    console.log(
      `mode=${mode} tier=${tier} handwritten=${scenarios.length - generatedCount} generated=${generatedCount} total=${scenarios.length}`,
    );
    console.log(`coverage=${coverage.covered}/${coverage.total} missing=${coverage.missing.length}`);
    if (printMode === 'count') return;
    for (const scenario of scenarios) {
      console.log(
        `${scenario.id}\t[${scenario.mode ?? mode}]\t${scenario.generated ? 'generated' : 'handwritten'}\t${(scenario.tags ?? []).join(',')}\t${scenario.name}`,
      );
    }
  });
} else if (scenarios.length === 0) {
  test('no scenarios matched filters', () => {
    throw new Error(`No scenarios matched mode=${mode} tier=${tier} filters=${JSON.stringify(filters)}`);
  });
} else {
  const handwritten = scenarios.filter((scenario) => !scenario.generated);
  const generated = scenarios.filter((scenario) => scenario.generated);

  for (const scenario of handwritten) {
    for (let runIndex = 0; runIndex < repeat; runIndex += 1) {
      test(`${scenario.id} [${mode}] run ${runIndex + 1}/${repeat}`, async () => {
        test.setTimeout(Math.max(scenario.timeoutMs ?? 300_000, 180_000));
        const ctx = await launchDesktop({
          mode,
          runId,
          scenarioId: scenario.id,
          runIndex,
        });
        mkdirSync(`${ctx.artifactDir}/screenshots`, { recursive: true });
        try {
          await executeScenario(ctx, scenario, runIndex);
        } finally {
          await closeDesktop(ctx);
        }
      });
    }
  }

  const batches = chunk(generated, 20);
  for (const [batchIndex, batch] of batches.entries()) {
    test(`generated batch ${batchIndex + 1}/${batches.length} (${batch.length} scenarios)`, async () => {
      const timeout = batch.reduce((sum, scenario) => sum + (scenario.timeoutMs ?? 60_000), 120_000);
      test.setTimeout(Math.min(timeout, 3_600_000));
      const ctx = await launchDesktop({
        mode,
        runId,
        scenarioId: `generated-batch-${batchIndex}`,
        runIndex: 0,
      });
      mkdirSync(`${ctx.artifactDir}/screenshots`, { recursive: true });
      try {
        for (const scenario of batch) {
          await executeScenario(ctx, scenario, 0);
        }
      } finally {
        await closeDesktop(ctx);
      }
    });
  }
}
