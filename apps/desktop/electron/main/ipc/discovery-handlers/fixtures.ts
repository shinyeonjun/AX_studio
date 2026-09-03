import { app } from 'electron';
import { realpathSync, statSync } from 'node:fs';
import { extname, isAbsolute, relative, resolve, sep } from 'node:path';
import { LocalFolderConnector, getAxDataPaths } from '@ax-studio/core';
import { ipcHandle } from '../ipc-handle.js';
import { getCore } from '../../core-instance.js';
import { notifyStateChanged } from '../../state-broadcast.js';

const DISCOVERY_ARTIFACT_EXTENSIONS = new Set(['.pdf', '.csv', '.xlsx', '.xls']);
let e2eDiscoveryArtifactPath: string | undefined;

function fixturePath(rawPath: unknown, expected: 'file' | 'directory'): string {
  if (typeof rawPath !== 'string' || !rawPath.trim()) {
    throw new Error('E2E fixture 경로가 필요합니다.');
  }

  try {
    const fixtureRoot = realpathSync(resolve(process.cwd(), 'test', 'fixtures'));
    const resolvedPath = realpathSync(rawPath.trim());
    const relativePath = relative(fixtureRoot, resolvedPath);
    const insideFixtureRoot = relativePath !== ''
      && relativePath !== '..'
      && !relativePath.startsWith(`..${sep}`)
      && !isAbsolute(relativePath);
    const stat = statSync(resolvedPath);
    if (!insideFixtureRoot || (expected === 'file' ? !stat.isFile() : !stat.isDirectory())) {
      throw new Error('E2E fixture 경로가 올바르지 않습니다.');
    }
    return resolvedPath;
  } catch (error) {
    if (error instanceof Error && error.message === 'E2E fixture 경로가 올바르지 않습니다.') throw error;
    throw new Error('E2E fixture 경로를 찾을 수 없습니다.');
  }
}

function validateDiscoveryArtifactPath(rawPath: unknown): string {
  const filePath = fixturePath(rawPath, 'file');
  if (!DISCOVERY_ARTIFACT_EXTENSIONS.has(extname(filePath).toLowerCase())) {
    throw new Error('지원하지 않는 Discovery fixture 형식입니다.');
  }
  return filePath;
}

export function pickDiscoveryArtifactPath(): string | undefined {
  const configuredPath = process.env.AX_E2E === '1' && !app.isPackaged
    ? process.env.AX_E2E_DISCOVERY_ARTIFACT_PATH?.trim() || e2eDiscoveryArtifactPath
    : undefined;
  e2eDiscoveryArtifactPath = undefined;
  return configuredPath ? validateDiscoveryArtifactPath(configuredPath) : undefined;
}

export function registerDiscoveryFixtureHandlers(): void {
  if (process.env.AX_E2E !== '1' || app.isPackaged) return;

  ipcHandle('ax:e2eSetDiscoveryArtifactPath', async (_event, rawFilePath: unknown) => {
    e2eDiscoveryArtifactPath = validateDiscoveryArtifactPath(rawFilePath);
    return { ok: true as const };
  });

  ipcHandle('ax:e2eConfigureDiscoveryFolder', async (_event, rawFolderPath: unknown) => {
    const folderPath = fixturePath(rawFolderPath, 'directory');
    const config = {
      folders: [{
        id: 'e2e-discovery-folder',
        label: 'QA 자료',
        path: folderPath,
        addedAt: new Date().toISOString(),
      }],
    };
    const core = getCore();
    core.store.setConnection('local_folder', true, config);
    core.runtime.setConnector('local_folder', new LocalFolderConnector(config));
    notifyStateChanged();
    return { ok: true as const };
  });
}
