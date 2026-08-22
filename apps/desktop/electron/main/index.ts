import { app } from 'electron';
import {
  createAxStudioCore,
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
import { loadAiTomlIntoEnv, migrateAiSecretsToOsStore } from './ai/config-file';
import { migrateDesktopAiProvider } from './ai/provider-migrate.js';
import { notifyStateChanged } from './state-broadcast.js';
import { initDesktopAxDataPaths } from './data-paths.js';
import { migrateAxDataIfNeeded } from './data-migrate.js';

if (!app.isPackaged) {
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  console.error(
    '[AX Studio] 이미 실행 중입니다. 기존 AX Studio 창을 모두 닫은 뒤 다시 `npm run dev` 하세요.',
  );
  console.error(
    '[AX Studio] 창이 없는데도 이러면 작업 관리자에서 Electron 프로세스를 종료하세요.',
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
    const paths = initDesktopAxDataPaths();
    migrateAxDataIfNeeded(paths);
    app.setPath('cache', paths.cache.chromium);

    await loadEnvFile();
    await migrateAiSecretsToOsStore();
    await purgeDisallowedEnvFileKeys();
    const aiToml = await loadAiTomlIntoEnv();

    const core = await createAxStudioCore({
      paths,
      desktopPrintBridge: { printHtml: printHtmlToPdf },
      onExecutionStarted: () => notifyStateChanged(),
      onExecutionProgress: () => notifyStateChanged(),
      onExecutionFinished: () => notifyStateChanged(),
    });

    if (aiToml.active) {
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

    await hydrateGmailConnector(core.store, core.runtime);
    await hydrateSlackConnector(core.store, core.runtime);
    await hydrateHttpConnector(core.store, core.runtime);
    await hydrateWebhookConnection(core.store);
    setWebhookSecretResolver(() => getWebhookSecret());

    setCore(core);
    registerIpcHandlers();
    createMainWindow();
    createTray();
    core.scheduler.start();
    core.triggerEngine.start();
  } catch (err) {
    console.error('AX Studio 시작 실패:', err);
  }
});

let shutdownStarted = false;

app.on('before-quit', (event) => {
  if (shutdownStarted) return;
  shutdownStarted = true;
  setQuiting(true);
  const core = getCoreIfInitialized();
  if (!core) return;
  event.preventDefault();
  core.scheduler.stop();
  void (async () => {
    try {
      await core.triggerEngine.stop();
      await core.runtime.waitForIdle();
    } catch (err) {
      console.error('[AX Studio] 종료 중 정리 실패:', err);
    } finally {
      core.db.close?.();
      app.quit();
    }
  })();
});
