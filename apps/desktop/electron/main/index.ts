import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { app, dialog } from 'electron';
import {
  createAxStudioCore,
  setDocumentEngineClient,
  setWebhookSecretResolver,
} from '@ax-studio/core';
import { createMainWindow, showMainWindow, setQuiting } from './app-window';
import { createTray } from './tray';
import { setCore, getCoreIfInitialized } from './core-instance';
import { registerIpcHandlers } from './ipc/handlers';
import { loadEnvFile, purgeDisallowedEnvFileKeys } from './env-file';
import { printHtmlToPdf } from './document-print.js';
import { hydrateGmailConnector } from './gmail/connection.js';
import { hydrateSlackConnector } from './slack/connection.js';
import { hydrateHttpConnector } from './http/connection.js';
import { getWebhookSecret, hydrateWebhookConnection } from './webhook/connection.js';
import { hydrateRdbConnector, resolveRdbConnectionConfig } from './rdb/connection.js';
import { hydrateOpenApiConnector } from './openapi/connection.js';
import { hydrateMcpConnector } from './mcp/connection.js';
import { loadAiTomlIntoEnv, migrateAiSecretsToOsStore } from './ai/config-file';
import { migrateDesktopAiProvider } from './ai/provider-migrate.js';
import { notifyStateChanged, notifyWorkspaceSourceChanged } from './state-broadcast.js';
import { applyDesktopAppIdentity, initDesktopAxDataPaths, resolveDesktopDataRoot } from './data-paths.js';
import { installDesktopFileLog } from './file-log.js';
import { migrateAxDataIfNeeded } from './data-migrate.js';
import { E2EDocumentEngineClient } from './e2e-test-seam.js';
import { abortAllWorkspaceChats } from './workspace-chat-registry.js';
import type { SlackSecret } from './slack/connection.js';

process.env.AX_SCAN_WORKER_PATH = join(dirname(fileURLToPath(import.meta.url)), 'scan-worker.js');

async function hydrateConnectorsForStartup(
  core: Awaited<ReturnType<typeof createAxStudioCore>>,
): Promise<SlackSecret | null> {
  const tolerateHydrationFailure = process.env.AX_E2E === '1';

  async function runStep<T>(label: string, step: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await step();
    } catch (err) {
      if (!tolerateHydrationFailure) throw err;
      console.warn(`[AX Studio] E2E: skipped ${label} hydration:`, err);
      return fallback;
    }
  }

  await runStep('gmail', () => hydrateGmailConnector(core.store, core.runtime), undefined);
  const slackSecret = await runStep(
    'slack',
    () => hydrateSlackConnector(core.store, core.runtime),
    null,
  );
  await runStep('http', () => hydrateHttpConnector(core.store, core.runtime), undefined);
  await runStep('webhook', () => hydrateWebhookConnection(core.store), undefined);
  await runStep('rdb', () => hydrateRdbConnector(core.store, core.runtime), undefined);
  await runStep('openapi', () => hydrateOpenApiConnector(core.store, core.runtime), undefined);
  await runStep('mcp', () => hydrateMcpConnector(core.store, core.runtime), undefined);
  return slackSecret;
}

if (!app.isPackaged) {
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
}
applyDesktopAppIdentity();
installDesktopFileLog();

const gotSingleInstanceLock = app.requestSingleInstanceLock();
const allowParallelInstance = process.env.AX_E2E === '1' || process.env.AX_PRODUCT_QA === '1';
if (!gotSingleInstanceLock && !allowParallelInstance) {
  const label = app.isPackaged ? 'AX Studio' : 'AX Studio Dev';
  console.error(
    `[${label}] 이미 실행 중입니다. 같은 종류의 창을 모두 닫은 뒤 다시 실행하세요.`,
  );
  console.error(
    `[${label}] 창이 없는데도 이러면 작업 관리자에서 Electron 프로세스를 종료하세요.`,
  );
  app.exit(0);
}

app.on('second-instance', () => showMainWindow());

process.on('uncaughtException', (err) => {
  console.error('[AX Studio] uncaughtException:', err);
});

process.on('unhandledRejection', (reason) => {
  console.error('[AX Studio] unhandledRejection:', reason);
});

app.whenReady().then(async () => {
  try {
    const isE2E = process.env.AX_E2E === '1';
    const paths = initDesktopAxDataPaths();
    if (!isE2E) migrateAxDataIfNeeded(paths);
    app.setPath('cache', paths.cache.chromium);

    if (process.env.AX_E2E === '1' && process.env.AX_E2E_DOCUMENT_ENGINE === 'mock') {
      setDocumentEngineClient(new E2EDocumentEngineClient());
    }

    let aiToml: Awaited<ReturnType<typeof loadAiTomlIntoEnv>> | null = null;
    if (!isE2E) {
      await loadEnvFile();
      await migrateAiSecretsToOsStore();
      await purgeDisallowedEnvFileKeys();
      aiToml = await loadAiTomlIntoEnv();
    }

    const core = await createAxStudioCore({
      paths,
      desktopPrintBridge: { printHtml: printHtmlToPdf },
      onExecutionStarted: () => notifyStateChanged(),
      onExecutionProgress: () => notifyStateChanged(),
      onExecutionFinished: () => notifyStateChanged(),
      onPushTransportStateChanged: () => notifyStateChanged(),
      resolveConnectionConfig: async (connector, config) =>
        connector === 'rdb' ? resolveRdbConnectionConfig(config) : config,
    });

    if (aiToml?.active) {
      const config = migrateDesktopAiProvider({
        brand: aiToml.active.brand,
        mode: aiToml.active.mode,
        model: aiToml.active.model,
      });
      core.store.setSetting('aiProvider', config);
      core.refreshAgentHarness(config);
    } else {
      const stored = core.store.getSetting('aiProvider', undefined);
      const config = migrateDesktopAiProvider(stored);
      if (JSON.stringify(stored) !== JSON.stringify(config)) {
        core.store.setSetting('aiProvider', config);
        core.refreshAgentHarness(config);
      }
    }

    setCore(core);
    unsubscribeWorkspaceSources = core.workspaceSources.subscribe((source) => notifyWorkspaceSourceChanged(source));
    registerIpcHandlers();
    // Show the window before connector hydration so first paint is not held
    // behind Gmail/Slack/HTTP/RDB secret loads and token refreshes.
    createMainWindow();
    createTray();

    const slackSecret = await hydrateConnectorsForStartup(core);
    setWebhookSecretResolver(() => getWebhookSecret());
    notifyStateChanged();
    core.scheduler.start();
    core.triggerEngine.start();
    if (slackSecret?.appToken) {
      try {
        await core.triggerEngine.refreshSlackSocket(slackSecret);
      } catch (err) {
        console.error('[AX Studio] Slack Socket Mode 시작 실패:', err);
      }
    }
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    console.error('AX Studio 시작 실패:', err);
    let logHint = '';
    try {
      logHint = `\n\n로그 위치: ${initDesktopAxDataPaths().logs}`;
    } catch {
      try {
        logHint = `\n\n데이터 위치: ${resolveDesktopDataRoot()}`;
      } catch {
        // ignore
      }
    }
    dialog.showErrorBox('AX Studio 시작 실패', `${detail}${logHint}`);
    app.exit(1);
  }
});

let shutdownStarted = false;
let unsubscribeWorkspaceSources: (() => void) | undefined;

app.on('before-quit', (event) => {
  if (shutdownStarted) return;
  shutdownStarted = true;
  setQuiting(true);
  const core = getCoreIfInitialized();
  if (!core) return;
  unsubscribeWorkspaceSources?.();
  unsubscribeWorkspaceSources = undefined;
  event.preventDefault();
  core.scheduler.stop();
  abortAllWorkspaceChats();
  void (async () => {
    try {
      await core.triggerEngine.stop();
      await core.runtime.waitForIdle();
      // Let a running PDF ingest settle so the source is not stranded as
      // `processing`, but never hold quit longer than a few seconds.
      await Promise.race([
        core.workspaceSources.waitForIdle(),
        new Promise<void>((resolve) => setTimeout(resolve, 5_000)),
      ]);
    } catch (err) {
      console.error('[AX Studio] 종료 중 정리 실패:', err);
    } finally {
      core.db.close?.();
      app.quit();
    }
  })();
});
