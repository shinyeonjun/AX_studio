import { app } from 'electron';
import { join } from 'node:path';
import { createAxStudioCore } from '@ax-studio/core';
import { createMainWindow, showMainWindow, setQuiting } from './app-window';
import { createTray } from './tray';
import { setCore, getCore } from './core-instance';
import { registerIpcHandlers } from './ipc/handlers';
import { loadEnvFile, purgeDisallowedEnvFileKeys } from './env-file';
import { hydrateGmailConnector } from './gmail/connection.js';
import { loadAiTomlIntoEnv, migrateAiSecretsToOsStore } from './ai/config-file';
import { migrateDesktopAiProvider } from './ai/provider-migrate.js';

const userDataPath = app.getPath('userData');
app.setPath('cache', join(userDataPath, 'chromium-cache'));

if (!app.isPackaged) {
  app.commandLine.appendSwitch('disable-gpu-shader-disk-cache');
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

app.on('second-instance', () => showMainWindow());

app.whenReady().then(async () => {
  try {
    await loadEnvFile();
    await migrateAiSecretsToOsStore();
    await purgeDisallowedEnvFileKeys();
    const aiToml = await loadAiTomlIntoEnv();
    const core = await createAxStudioCore({ dbPath: join(app.getPath('userData'), 'ax-studio.db') });

    if (aiToml.active) {
      const config = migrateDesktopAiProvider({
        brand: aiToml.active.brand,
        mode: aiToml.active.mode,
        model: aiToml.active.model,
      });
      core.store.setSetting('aiProvider', config);
      core.refreshAgentHarness(config);
    } else {
      const stored = core.store.getSetting('aiProvider');
      const config = migrateDesktopAiProvider(stored);
      if (JSON.stringify(stored) !== JSON.stringify(config)) {
        core.store.setSetting('aiProvider', config);
        core.refreshAgentHarness(config);
      }
    }

    await hydrateGmailConnector(core.store, core.runtime);

    setCore(core);
    createMainWindow();
    createTray();
    registerIpcHandlers();
    core.scheduler.start();
    core.triggerEngine.start();
  } catch (err) {
    console.error('AX Studio 시작 실패:', err);
  }
});

app.on('before-quit', () => {
  setQuiting(true);
  getCore().scheduler.stop();
  getCore().triggerEngine.stop();
});
