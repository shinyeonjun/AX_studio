import { dialog } from 'electron';
import { copyFile } from 'node:fs/promises';
import { ArtifactStore, getAxDataPaths, type StoredArtifact } from '@ax-studio/core';
import type { GeneratedArtifactExportDependencies } from './contracts.js';
import { resolveGeneratedArtifactSourcePath } from './source.js';

export function defaultDependencies(): GeneratedArtifactExportDependencies {
  const store = new ArtifactStore(getAxDataPaths().generated.reports);
  return {
    getArtifact: (artifactId) => store.get(artifactId),
    resolveSourcePath: (artifact: StoredArtifact) =>
      resolveGeneratedArtifactSourcePath(store.root, artifact.storedPath, artifact.size, artifact.sha256),
    showSaveDialog: async (fileName) => {
      const result = await dialog.showSaveDialog({
        title: 'PDF 저장',
        defaultPath: fileName,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      return { canceled: result.canceled, filePath: result.filePath };
    },
    copyFile,
  };
}
