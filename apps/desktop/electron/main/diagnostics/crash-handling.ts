import { app, crashReporter, dialog } from 'electron';
import { join } from 'node:path';
import { appendAppLog, flushAppLogSync } from '@ax-studio/core';
import { getDesktopLogDirectory } from '../file-log.js';
import { MAIN_CRASH_POLICY, recordPersistentCrash } from './crash-guard.js';

export const CRASH_HISTORY_FILE = 'crash-history.json';

export function crashHistoryPath(): string {
  return join(getDesktopLogDirectory(), CRASH_HISTORY_FILE);
}

/** Keep Chromium/Node minidumps locally (app.getPath('crashDumps')); nothing is uploaded. */
export function startLocalCrashReporter(): void {
  try {
    crashReporter.start({ uploadToServer: false });
  } catch (err) {
    console.error('[AX Studio] crash reporter start failed:', err);
  }
}

export interface FatalErrorDeps {
  isPackaged: boolean;
  recordCrash: () => boolean;
  showErrorBox: (title: string, content: string) => void;
  markQuitting: () => void;
  relaunch: () => void;
  exit: (code: number) => void;
  logDirectory: () => string;
}

let handlingFatal = false;

/**
 * uncaughtException policy. Unpackaged runs only log (keeps the dev session
 * and its stack trace alive). Packaged runs log, tell the user, and relaunch
 * unless the persisted crash history shows a crash loop.
 */
export function handleFatalMainError(error: unknown, deps: FatalErrorDeps): void {
  console.error('[AX Studio] uncaughtException:', error);
  if (!deps.isPackaged || handlingFatal) {
    flushAppLogSync();
    return;
  }
  handlingFatal = true;
  let relaunch = false;
  try {
    relaunch = deps.recordCrash();
    appendAppLog('error', relaunch
      ? 'Main process crashed; relaunching.'
      : 'Main process crash loop detected; automatic relaunch stopped.');
  } finally {
    flushAppLogSync();
  }
  const detail = error instanceof Error ? error.message : String(error);
  try {
    deps.showErrorBox(
      'AX Studio 오류',
      [
        relaunch
          ? '예기치 않은 오류가 발생해 AX Studio를 다시 시작합니다.'
          : '오류가 반복되어 자동 재시작을 중단했습니다. 문제가 계속되면 로그 폴더의 내용을 전달해 주세요.',
        '',
        detail.slice(0, 500),
        '',
        `로그 위치: ${deps.logDirectory()}`,
      ].join('\n'),
    );
  } catch {
    // Exiting matters more than the notice.
  }
  deps.markQuitting();
  if (relaunch) deps.relaunch();
  deps.exit(1);
}

export function resetFatalHandlingForTest(): void {
  handlingFatal = false;
}

export function registerProcessCrashHandlers(markQuitting: () => void): void {
  process.on('uncaughtException', (error) => {
    handleFatalMainError(error, {
      isPackaged: app.isPackaged,
      recordCrash: () => recordPersistentCrash(crashHistoryPath(), MAIN_CRASH_POLICY),
      showErrorBox: (title, content) => dialog.showErrorBox(title, content),
      markQuitting,
      relaunch: () => app.relaunch(),
      exit: (code) => app.exit(code),
      logDirectory: getDesktopLogDirectory,
    });
  });

  process.on('unhandledRejection', (reason) => {
    console.error('[AX Studio] unhandledRejection:', reason);
  });

  app.on('child-process-gone', (_event, details) => {
    if (details.reason === 'clean-exit') return;
    console.error('[AX Studio] child process gone:', {
      type: details.type,
      reason: details.reason,
      exitCode: details.exitCode,
      name: details.name,
      serviceName: details.serviceName,
    });
  });
}
