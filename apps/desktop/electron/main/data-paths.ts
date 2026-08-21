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

export function resolveDesktopDataRoot(): string {
  return resolvePlatformDataRoot();
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
