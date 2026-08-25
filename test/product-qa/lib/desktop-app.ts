import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { prepareProductQaDataRoot } from './data-root.js';
import type { ProductQaMode } from './types.js';

const require = createRequire(import.meta.url);
const electronExecutable = require('electron') as string;

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '../../..');

export interface LaunchOptions {
  mode: ProductQaMode;
  dataRoot?: string;
  runId: string;
  scenarioId?: string;
  runIndex?: number;
}

export interface DesktopContext {
  app: ElectronApplication;
  page: Page;
  dataRoot: string;
  mode: ProductQaMode;
  artifactDir: string;
}

function defaultDataRoot(): string {
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Local');
    return join(local, 'AXStudio');
  }
  if (process.platform === 'darwin') {
    return join(process.env.HOME ?? '', 'Library', 'Application Support', 'AXStudio');
  }
  const xdg = process.env.XDG_DATA_HOME ?? join(process.env.HOME ?? '', '.local', 'share');
  return join(xdg, 'AXStudio');
}

function resolveDataRoot(options: LaunchOptions): string {
  const isolated = process.env.AX_PRODUCT_QA_ISOLATED === '1';
  const artifactDir = join(repoRoot, 'test/product-qa/runs', options.runId);

  if (options.dataRoot?.trim()) return options.dataRoot.trim();
  if (process.env.AX_DATA_ROOT?.trim()) return process.env.AX_DATA_ROOT.trim();

  if (isolated) {
    const suffix = options.scenarioId
      ? `${options.scenarioId}-${options.runIndex ?? 0}`
      : 'default';
    const dataRoot = join(artifactDir, 'data', suffix);
    prepareProductQaDataRoot(dataRoot, {
      sourceRoot: process.env.AX_PRODUCT_QA_SOURCE_DATA_ROOT?.trim(),
    });
    return dataRoot;
  }

  return defaultDataRoot();
}

function useIsolatedElectronProfile(): boolean {
  return process.env.AX_PRODUCT_QA_ISOLATED === '1';
}

function buildEnv(options: LaunchOptions): NodeJS.ProcessEnv {
  const dataRoot = resolveDataRoot(options);
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    AX_DATA_ROOT: dataRoot,
    AX_PRODUCT_QA: '1',
    AX_PRODUCT_QA_RUN_ID: options.runId,
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
  };
  delete env.ELECTRON_RENDERER_URL;

  if (options.mode === 'deterministic') {
    env.AX_E2E = '1';
    env.AX_E2E_FAKE_AGENT = '1';
    env.AX_E2E_DOCUMENT_ENGINE = 'mock';
    env.AX_E2E_AGENT_DELAY_MS = process.env.AX_E2E_AGENT_DELAY_MS ?? '1200';
  } else {
    delete env.AX_E2E;
    delete env.AX_E2E_FAKE_AGENT;
    delete env.AX_E2E_DOCUMENT_ENGINE;
  }

  return env;
}

export async function launchDesktop(options: LaunchOptions): Promise<DesktopContext> {
  const mainEntry = join(repoRoot, 'apps/desktop/out/main/index.js');
  const artifactDir = join(repoRoot, 'test/product-qa/runs', options.runId);
  mkdirSync(artifactDir, { recursive: true });

  const env = buildEnv(options);
  const dataRoot = env.AX_DATA_ROOT!;

  const userDataDir = join(artifactDir, 'electron-user-data');
  const electronArgs = [mainEntry];
  if (useIsolatedElectronProfile()) {
    mkdirSync(userDataDir, { recursive: true });
    electronArgs.push(`--user-data-dir=${userDataDir}`);
  }

  const app = await electron.launch({
    executablePath: electronExecutable,
    args: electronArgs,
    cwd: repoRoot,
    env,
    timeout: 120_000,
  });

  const page = await app.firstWindow({ timeout: 120_000 });
  await page.waitForLoadState('domcontentloaded');
  await page.getByRole('button', { name: '새 대화' }).waitFor({ state: 'visible', timeout: 60_000 });

  return { app, page, dataRoot, mode: options.mode, artifactDir };
}

export async function closeDesktop(ctx: DesktopContext): Promise<void> {
  await ctx.app.close();
}

export function fixturePath(name: string): string {
  return join(repoRoot, 'test/fixtures', name);
}

export function tempRunId(): string {
  return `run-${Date.now()}`;
}

export function defaultReplyTimeoutMs(): number {
  const value = Number.parseInt(process.env.AX_PRODUCT_QA_REPLY_TIMEOUT_MS ?? '120000', 10);
  return Number.isFinite(value) ? Math.max(5_000, value) : 120_000;
}
