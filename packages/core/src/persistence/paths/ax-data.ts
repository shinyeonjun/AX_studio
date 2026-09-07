import { mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface AxDataPaths {
  root: string;
  database: string;
  credentials: string;
  config: string;
  documents: string;
  artifacts: string;
  sessions: string;
  templates: string;
  generated: {
    reports: string;
    exports: string;
  };
  cache: {
    root: string;
    chromium: string;
    documentEngine: string;
  };
  logs: string;
  migration: string;
}

export const AX_DATA_FOLDER_STABLE = 'AXStudio';
export const AX_DATA_FOLDER_DEV = 'AXStudio-dev';

export function resolvePlatformDataRoot(folderName: string = AX_DATA_FOLDER_STABLE): string {
  if (process.platform === 'win32') {
    const local = process.env.LOCALAPPDATA ?? join(homedir(), 'AppData', 'Local');
    return join(local, folderName);
  }
  if (process.platform === 'darwin') {
    return join(homedir(), 'Library', 'Application Support', folderName);
  }
  const xdg = process.env.XDG_DATA_HOME ?? join(homedir(), '.local', 'share');
  return join(xdg, folderName);
}

/** @deprecated Pre-unified layout under home directory. Used for one-time migration only. */
export function legacyHomeDataRoot(): string {
  return join(homedir(), '.ax-studio');
}

export function buildAxDataPaths(root: string): AxDataPaths {
  return {
    root,
    database: join(root, 'data', 'ax-studio.db'),
    credentials: join(root, 'credentials'),
    config: join(root, 'config'),
    documents: join(root, 'documents'),
    artifacts: join(root, 'artifacts'),
    sessions: join(root, 'sessions'),
    templates: join(root, 'templates'),
    generated: {
      reports: join(root, 'generated', 'reports'),
      exports: join(root, 'generated', 'exports'),
    },
    cache: {
      root: join(root, 'cache'),
      chromium: join(root, 'cache', 'chromium'),
      documentEngine: join(root, 'cache', 'document-engine'),
    },
    logs: join(root, 'logs'),
    migration: join(root, 'config', 'migration.json'),
  };
}

let configuredPaths: AxDataPaths | null = null;

export function setAxDataPaths(paths: AxDataPaths | null): void {
  configuredPaths = paths;
}

export function getAxDataPaths(): AxDataPaths {
  if (configuredPaths) return configuredPaths;
  return resolveAxDataPaths();
}

export function resolveAxDataPaths(options: { dataRoot?: string } = {}): AxDataPaths {
  if (options.dataRoot) {
    return buildAxDataPaths(options.dataRoot);
  }
  const fromEnv = process.env.AX_DATA_ROOT?.trim();
  if (fromEnv) {
    return buildAxDataPaths(fromEnv);
  }
  return buildAxDataPaths(resolvePlatformDataRoot());
}

export function ensureAxDataLayout(paths: AxDataPaths): void {
  const dirs = [
    join(paths.root, 'data'),
    paths.credentials,
    paths.config,
    paths.documents,
    paths.artifacts,
    paths.sessions,
    paths.templates,
    paths.generated.reports,
    paths.generated.exports,
    paths.cache.root,
    paths.cache.chromium,
    paths.cache.documentEngine,
    paths.logs,
  ];
  for (const dir of dirs) {
    mkdirSync(dir, { recursive: true });
  }
}
