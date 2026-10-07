import { app, BrowserWindow, dialog, shell } from 'electron';
import { freemem, homedir, release, totalmem } from 'node:os';
import { join } from 'node:path';
import { flushAppLog } from '@ax-studio/core';
import { ipcHandle } from '../ipc/ipc-handle.js';
import { userFacingError } from '../ipc/user-facing-error.js';
import { getCoreIfInitialized } from '../core-instance.js';
import { getDesktopLogDirectory } from '../file-log.js';
import { resolveDesktopDataRoot } from '../data-paths.js';
import { readCrashHistory } from './crash-guard.js';
import { crashHistoryPath } from './crash-handling.js';
import {
  buildDiagnosticsReport,
  collectRecentLogs,
  countMinidumps,
  diagnosticsFileName,
  writeDiagnosticsReport,
} from './export.js';

type DiagnosticsExportResult =
  | { ok: true; path: string }
  | { ok: false; canceled: true }
  | { ok: false; error: string };

type OpenLogFolderResult = { ok: true } | { ok: false; error: string };

function safePath(read: () => string): string {
  try {
    return read();
  } catch {
    return 'unavailable';
  }
}

async function buildReport(): Promise<string> {
  await flushAppLog();
  const logs = getDesktopLogDirectory();
  const crashDumps = safePath(() => app.getPath('crashDumps'));
  const connections = getCoreIfInitialized()?.store.getConnections() ?? [];
  return buildDiagnosticsReport({
    generatedAt: new Date(),
    app: {
      name: app.getName(),
      version: app.getVersion(),
      packaged: app.isPackaged,
      locale: app.getLocale(),
      uptimeSeconds: process.uptime(),
    },
    runtime: {
      electron: process.versions.electron,
      chrome: process.versions.chrome,
      node: process.versions.node,
      v8: process.versions.v8,
    },
    os: {
      platform: process.platform,
      release: release(),
      arch: process.arch,
      totalMemoryMb: Math.round(totalmem() / 1_048_576),
      freeMemoryMb: Math.round(freemem() / 1_048_576),
    },
    paths: {
      dataRoot: safePath(resolveDesktopDataRoot),
      logs,
      userData: safePath(() => app.getPath('userData')),
      crashDumps,
    },
    connectors: connections.map((connection) => ({
      connector: String(connection.connector),
      connected: Boolean(connection.connected),
    })),
    crashes: {
      recentMainCrashes: readCrashHistory(crashHistoryPath()).map((at) => new Date(at).toISOString()),
      minidumpCount: crashDumps === 'unavailable' ? 0 : await countMinidumps(crashDumps),
    },
    logs: await collectRecentLogs(logs),
    homeDirectory: homedir(),
  });
}

export function registerDiagnosticsHandlers(): void {
  ipcHandle('ax:exportDiagnostics', async (event): Promise<DiagnosticsExportResult> => {
    try {
      const options: Electron.SaveDialogOptions = {
        title: '진단 정보 내보내기',
        defaultPath: join(app.getPath('downloads'), diagnosticsFileName(new Date())),
        filters: [{ name: 'Text', extensions: ['txt'] }],
      };
      const owner = BrowserWindow.fromWebContents(event.sender);
      const picked = owner ? await dialog.showSaveDialog(owner, options) : await dialog.showSaveDialog(options);
      if (picked.canceled || !picked.filePath) return { ok: false, canceled: true };
      await writeDiagnosticsReport(picked.filePath, await buildReport());
      console.info('[AX Studio] diagnostics exported');
      return { ok: true, path: picked.filePath };
    } catch (err) {
      console.error('[AX Studio] diagnostics export failed:', err);
      return { ok: false, error: userFacingError(err, '이 위치에 저장할 수 없어요. 다른 위치를 골라 주세요.') };
    }
  });

  ipcHandle('ax:openLogFolder', async (): Promise<OpenLogFolderResult> => {
    await flushAppLog();
    const error = await shell.openPath(getDesktopLogDirectory());
    return error ? { ok: false, error: userFacingError(error, '폴더가 없거나 열 권한이 없어요.') } : { ok: true };
  });
}
