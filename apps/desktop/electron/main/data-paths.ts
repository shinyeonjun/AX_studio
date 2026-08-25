import { app } from 'electron';
import { homedir } from 'node:os';
import { join } from 'node:path';
import {
  buildAxDataPaths,
  ensureAxDataLayout,
  resolvePlatformDataRoot,
  setAxDataPaths,
  type AxDataPaths,
} from '@ax-studio/core';

let desktopPaths: AxDataPaths | null = null;

const DEV_FOLDER = 'AXStudio-dev';

function hasExplicitUserDataDir(): boolean {
  return process.argv.some((arg) => arg === '--user-data-dir' || arg.startsWith('--user-data-dir='));
}

function defaultDataRoot(packaged: boolean): string {
  const stable = resolvePlatformDataRoot();
  if (packaged) return stable;
  return join(stable, '..', DEV_FOLDER);
}

export function desktopAppDisplayName(packaged = app.isPackaged): string {
  return packaged ? 'AX Studio' : 'AX Studio Dev';
}

export function resolveDesktopDataRoot(): string {
  if (process.env.AX_DATA_ROOT?.trim()) return process.env.AX_DATA_ROOT.trim();
  return defaultDataRoot(app.isPackaged);
}

/**
 * Isolate unpackaged `npm run dev` from the installed app before ready /
 * requestSingleInstanceLock. Tests that pass `--user-data-dir` keep Playwright isolation.
 */
export function applyDesktopAppIdentity(): void {
  if (app.isPackaged) return;

  app.setName(desktopAppDisplayName(false));
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.axstudio.desktop.dev');
  }
  if (hasExplicitUserDataDir()) return;

  app.setPath('userData', join(defaultDataRoot(false), 'electron'));
}

export function initDesktopAxDataPaths(): AxDataPaths {
  const paths = buildAxDataPaths(resolveDesktopDataRoot());
  ensureAxDataLayout(paths);
  setAxDataPaths(paths);
  desktopPaths = paths;
  process.env.AX_DATA_ROOT = paths.root;
  return paths;
}

export function getDesktopAxDataPaths(): AxDataPaths {
  if (!desktopPaths) {
    throw new Error('Desktop AX data paths are not initialized');
  }
  return desktopPaths;
}

/** Legacy Electron userData — migration source only. */
export function legacyElectronUserDataDir(): string {
  return app.getPath('userData');
}

/** Legacy home artifact root — migration source only. */
export function legacyHomeArtifactRoot(): string {
  return join(homedir(), '.ax-studio');
}
