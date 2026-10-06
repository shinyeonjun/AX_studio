import { app, dialog } from 'electron';
import {
  createAxStudioCore,
  flushAppLogSync,
  type DecisionEngine,
  setDocumentEngineClient,
  setDocumentEngineEnvOverridesAllowed,
  sweepEngineTempFiles,
  defaultArtifactRoot,
  defaultTemplateRoot,
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
import { migrateAxDataOrContinue } from '../data-migrate.js';
import { E2EDocumentEngineClient } from '../e2e-test-seam.js';
import { isE2ERuntimeEnabled, shouldLoadE2EBenchmarkReportPlanner } from '../e2e-test-seam/gates.js';
import { loadE2EBenchmarkReportPlanner } from '../e2e-test-seam/report-planner.js';
import { hydrateConnectorsForStartup } from './connectors.js';
import { createStartupJevDecisionEngine } from './jev.js';
import { drainDesktopCore, isDesktopShuttingDown, setDesktopStartupTask, setWorkspaceSourceUnsubscribe } from './lifecycle.js';

const HISTORY_RETENTION_INTERVAL_MS = 24 * 60 * 60 * 1_000;

async function runNonFatalStartupStep<T>(label: string, step: () => Promise<T>): Promise<T | undefined> {
  try {
    return await step();
  } catch (err) {
    console.error(`[AX Studio] ${label} failed; continuing startup`, {
      code: (err as { code?: unknown } | null)?.code,
      message: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

/** Startup retention runs in core bootstrap; repeat it daily for long-lived sessions. */
function scheduleHistoryRetention(core: { store: { pruneHistory(): unknown } }): void {
  const timer = setInterval(() => {
    if (isDesktopShuttingDown()) {
      clearInterval(timer);
      return;
    }
    try { core.store.pruneHistory(); }
    catch (err) { console.warn('[AX Studio] history retention failed', { code: (err as { code?: unknown } | null)?.code }); }
  }, HISTORY_RETENTION_INTERVAL_MS);
  timer.unref?.();
}

export function registerDesktopReadyHandler(): void {
  const startup = app.whenReady().then(async () => {
    try {
      if (isDesktopShuttingDown()) return;
      // Packaged builds always use the bundled document-engine worker and Python.
      setDocumentEngineEnvOverridesAllowed(!app.isPackaged);
      const isE2E = isE2ERuntimeEnabled(app.isPackaged, process.env);
      const paths = initDesktopAxDataPaths();
      if (!isE2E) await migrateAxDataOrContinue(paths);
      app.setPath('cache', paths.cache.chromium);

      if (isE2E && process.env.AX_E2E_DOCUMENT_ENGINE === 'mock') {
        setDocumentEngineClient(new E2EDocumentEngineClient());
      }

      let aiToml: Awaited<ReturnType<typeof loadAiTomlIntoEnv>> | null = null;
      if (!isE2E) {
        await loadEnvFile();
        // An unreadable stored secret (DPAPI/keyring change) must not block startup;
        // the affected provider simply reads as unconfigured until re-entered.
        await runNonFatalStartupStep('AI secret migration', () => migrateAiSecretsToOsStore());
        await purgeDisallowedEnvFileKeys();
        aiToml = await runNonFatalStartupStep('AI config load', () => loadAiTomlIntoEnv()) ?? null;
      }

      let decisionEngine: DecisionEngine | undefined;
      if (!isE2E) {
        decisionEngine = createStartupJevDecisionEngine(aiToml?.decision?.jev, process.env);
      }

      if (isDesktopShuttingDown()) return;
      const reportPlanner = shouldLoadE2EBenchmarkReportPlanner(app.isPackaged, process.env)
        ? await loadE2EBenchmarkReportPlanner(process.env.AX_E2E_REPORT_CASE?.trim() || 'complete-api-db-report')
        : undefined;
      const core = await createAxStudioCore({
        paths,
        decisionEngine,
        reportPlanner,
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

      // Connector failures are recorded per connection, never fatal to startup.
      const slackSecret = await runNonFatalStartupStep('connector hydration', () => hydrateConnectorsForStartup(core)) ?? null;
      if (isDesktopShuttingDown()) return;
      scheduleHistoryRetention(core);
      // Temp files a force-killed engine worker left behind; background, never blocks startup.
      void sweepEngineTempFiles([defaultArtifactRoot(), defaultTemplateRoot()])
        .then((removed) => { if (removed > 0) console.info(`[AX Studio] removed ${removed} leftover document-engine temp files`); })
        .catch(() => undefined);
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
      // app.exit skips async log writes; flush so the startup failure reaches the log file.
      try { flushAppLogSync(); } catch { /* Exiting regardless. */ }
      app.exit(1);
    }
  });
  setDesktopStartupTask(startup);
}
