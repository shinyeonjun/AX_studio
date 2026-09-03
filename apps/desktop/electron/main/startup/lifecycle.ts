import { app } from 'electron';
import { showMainWindow, setQuiting } from '../app-window';
import { getCoreIfInitialized } from '../core-instance';
import { abortAllWorkspaceChats } from '../workspace-chat-registry.js';

let shutdownStarted = false;
let unsubscribeWorkspaceSources: (() => void) | undefined;

export function registerDesktopInstanceGuards(): void {
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
}

export function setWorkspaceSourceUnsubscribe(unsubscribe: () => void): void {
  unsubscribeWorkspaceSources = unsubscribe;
}

export function registerDesktopShutdown(): void {
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
}
