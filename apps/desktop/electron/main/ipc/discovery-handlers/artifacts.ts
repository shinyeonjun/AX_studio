import { dialog } from 'electron';
import { join } from 'node:path';
import { ArtifactStore, getAxDataPaths, importDiscoveryArtifact } from '@ax-studio/core';
import { ipcHandle } from '../ipc-handle.js';
import { userFacingError } from '../user-facing-error.js';
import { pickDiscoveryArtifactPath } from './fixtures.js';

function artifactStore(): ArtifactStore {
  return new ArtifactStore(join(getAxDataPaths().root, 'artifacts'));
}

/** Past results learned from at once: a few periods of one report, not a whole archive. */
const MAX_EXAMPLES = 6;

export function registerDiscoveryArtifactHandlers(): void {
  ipcHandle('ax:importArtifact', async () => {
    const e2ePath = pickDiscoveryArtifactPath();
    let sourcePaths = e2ePath ? [e2ePath] : [];
    if (sourcePaths.length === 0) {
      // Several months of the same report teach the method better than one.
      const result = await dialog.showOpenDialog({
        title: '지난 결과물 선택 (여러 달 치를 함께 고르면 더 정확해요)',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: '문서', extensions: ['pdf', 'csv', 'xlsx', 'xls'] },
        ],
      });
      if (result.canceled || result.filePaths.length === 0) {
        return { ok: false as const, canceled: true as const };
      }
      sourcePaths = result.filePaths.slice(0, MAX_EXAMPLES);
    }
    try {
      const store = artifactStore();
      const stored = [];
      for (const sourcePath of sourcePaths) stored.push(await importDiscoveryArtifact(store, sourcePath));
      return { ok: true as const, artifact: stored[0]!, artifacts: stored };
    } catch (error) {
      return {
        ok: false as const,
        error: userFacingError(error, '파일을 가져오지 못했어요. 파일이 다른 프로그램에서 열려 있지 않은지 확인한 뒤 다시 시도해 주세요.'),
      };
    }
  });
}
