import { app } from 'electron';
import { shutdownCommandProcesses } from '@ax-studio/core';
import { drainWithin } from './drain.js';
import { showMainWindow, setQuiting } from '../app-window';
import { getCoreIfInitialized } from '../core-instance';
import { abortAllWorkspaceChats } from '../workspace-chat-registry.js';

let shutdownStarted = false;
let shutdownCompleted = false;
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
    if (shutdownCompleted) return;
    if (shutdownStarted) { event.preventDefault(); return; }
    shutdownStarted = true;
    setQuiting(true);
    const core = getCoreIfInitialized();
    if (!core) return;
    unsubscribeWorkspaceSources?.();
    unsubscribeWorkspaceSources = undefined;
    event.preventDefault();
    core.scheduler.stop();
    core.runtime.stopAccepting();
    core.workspaceSources.stopAccepting();
    abortAllWorkspaceChats();
    void (async () => {
      try {
        const drained = await drainWithin([
          () => core.triggerEngine.stop(),
          () => core.runtime.waitForIdle(),
          () => core.workspaceSources.waitForIdle(),
          () => shutdownCommandProcesses(4_000),
          () => core.agentHarness.dispose(),
        ], 5_000);
        if (!drained) {
          // Do not close the shared DB underneath still-running callbacks.
          console.error('[AX Studio] 종료 대기 초과: 미완료 작업은 재시작 시 확인이 필요합니다.');
          app.exit(1);
          return;
        }
        core.db.close?.();
        shutdownCompleted = true;
        app.quit();
      } catch (err) {
        console.error('[AX Studio] 종료 중 정리 실패:', err);
        app.exit(1);
      }
    })();
  });
}
