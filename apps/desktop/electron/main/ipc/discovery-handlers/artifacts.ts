import { dialog } from 'electron';
import { join } from 'node:path';
import { ArtifactStore, getAxDataPaths, importDiscoveryArtifact } from '@ax-studio/core';
import { ipcHandle } from '../ipc-handle.js';
import { pickDiscoveryArtifactPath } from './fixtures.js';

function artifactStore(): ArtifactStore {
  return new ArtifactStore(join(getAxDataPaths().root, 'artifacts'));
}

export function registerDiscoveryArtifactHandlers(): void {
  ipcHandle('ax:importArtifact', async () => {
    const e2ePath = pickDiscoveryArtifactPath();
    let sourcePath = e2ePath;
    if (!sourcePath) {
      const result = await dialog.showOpenDialog({
        title: '지난 결과물 선택',
        properties: ['openFile'],
        filters: [
          { name: 'Documents', extensions: ['pdf', 'csv', 'xlsx', 'xls'] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false as const, canceled: true as const };
      }
      sourcePath = result.filePaths[0];
    }
    try {
      const stored = await importDiscoveryArtifact(artifactStore(), sourcePath);
      return { ok: true as const, artifact: stored };
    } catch (error) {
      return {
        ok: false as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
}
