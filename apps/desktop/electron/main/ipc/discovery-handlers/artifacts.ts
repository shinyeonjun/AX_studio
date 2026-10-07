import { dialog } from 'electron';
import { join } from 'node:path';
import { ArtifactStore, getAxDataPaths, importDiscoveryArtifact } from '@ax-studio/core';
import { ipcHandle } from '../ipc-handle.js';
import { userFacingError } from '../user-facing-error.js';
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
        error: userFacingError(error, '파일을 가져오지 못했어요. 파일이 다른 프로그램에서 열려 있지 않은지 확인한 뒤 다시 시도해 주세요.'),
      };
    }
  });
}
