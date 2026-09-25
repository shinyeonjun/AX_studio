import { app, dialog } from 'electron';
import {
  createAxStudioCore,
  type DecisionEngine,
  createExperimentalJevDecisionEngineFromEnvironment,
  JevDecisionEngine,
  setDocumentEngineClient,
  setWebhookSecretResolver,
} from '@ax-studio/core';
import { createMainWindow } from '../app-window';
import { createTray } from '../tray';
import { setCore } from '../core-instance';
import { registerIpcHandlers } from '../ipc/handlers';
import { loadEnvFile, purgeDisallowedEnvFileKeys } from '../env-file';
import { printHtmlToPdf } from '../document-print.js';
import { getWebhookSecret } from '../webhook/connection.js';
import { resolveRdbConnectionConfig } from '../rdb/connection.js';
import { loadAiTomlIntoEnv, migrateAiSecretsToOsStore } from '../ai/config-file';
import { migrateDesktopAiProvider } from '../ai/provider-migrate.js';
import {
  notifyStateChanged,
  notifyWorkspaceChatChanged,
  notifyWorkspaceSourceChanged,
} from '../state-broadcast.js';
import {
  initDesktopAxDataPaths,
  resolveDesktopDataRoot,
} from '../data-paths.js';
import { migrateAxDataIfNeeded } from '../data-migrate.js';
import { E2EDocumentEngineClient } from '../e2e-test-seam.js';
import { hydrateConnectorsForStartup } from './connectors.js';
import { drainDesktopCore, isDesktopShuttingDown, setDesktopStartupTask, setWorkspaceSourceUnsubscribe } from './lifecycle.js';

export function registerDesktopReadyHandler(): void {
  const startup = app.whenReady().then(async () => {
    try {
      if (isDesktopShuttingDown()) return;
      const isE2E = !app.isPackaged && process.env.AX_E2E === '1';
      const paths = initDesktopAxDataPaths();
      if (!isE2E) await migrateAxDataIfNeeded(paths);
      app.setPath('cache', paths.cache.chromium);

      if (isE2E && process.env.AX_E2E_DOCUMENT_ENGINE === 'mock') {
        setDocumentEngineClient(new E2EDocumentEngineClient());
      }

      let aiToml: Awaited<ReturnType<typeof loadAiTomlIntoEnv>> | null = null;
      if (!isE2E) {
        await loadEnvFile();
        await migrateAiSecretsToOsStore();
        await purgeDisallowedEnvFileKeys();
        aiToml = await loadAiTomlIntoEnv();
      }

      let decisionEngine: DecisionEngine | undefined;
      if (!isE2E) {
        const jev = aiToml?.decision?.jev;
        const apiKey = process.env.TYPESAFE_API_KEY?.trim();
        if (jev?.enabled && apiKey) {
          decisionEngine = new JevDecisionEngine({
            apiKey,
            model: jev.model?.trim() || undefined,
            baseURL: jev.baseURL?.trim() || undefined,
          });
        } else {
          decisionEngine = createExperimentalJevDecisionEngineFromEnvironment();
        }
      }

      if (isDesktopShuttingDown()) return;
      const core = await createAxStudioCore({
        paths,
        decisionEngine,
        desktopPrintBridge: { printHtml: printHtmlToPdf },
        onExecutionStarted: () => notifyStateChanged(),
        onExecutionProgress: () => notifyStateChanged(),
        onExecutionFinished: () => notifyStateChanged(),
        onWorkspaceChatChanged: notifyWorkspaceChatChanged,
        onPushTransportStateChanged: () => notifyStateChanged(),
        resolveConnectionConfig: async (connector, config) =>
          connector === 'rdb' ? resolveRdbConnectionConfig(config) : config,
      });

      if (isDesktopShuttingDown()) {
        if (!await drainDesktopCore(core)) throw new Error('desktop_late_core_drain_failed');
        return;
      }

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
      setWorkspaceSourceUnsubscribe(
        core.workspaceSources.subscribe((source) => notifyWorkspaceSourceChanged(source)),
      );
      registerIpcHandlers();
      // Show the window before connector hydration so first paint is not held
      // behind Gmail/Slack/HTTP/RDB secret loads and token refreshes.
      createMainWindow();
      createTray();

      const slackSecret = await hydrateConnectorsForStartup(core);
      if (isDesktopShuttingDown()) return;
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
  setDesktopStartupTask(startup);
}
