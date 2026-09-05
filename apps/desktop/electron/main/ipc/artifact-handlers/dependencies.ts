import { dialog } from 'electron';
import { constants } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { ArtifactStore, getAxDataPaths, type StoredArtifact } from '@ax-studio/core';
import type {
  GeneratedArtifactExportDependencies,
  GeneratedArtifactFolderSaveDependencies,
} from './contracts.js';
import { resolveGeneratedArtifactSourcePath } from './source.js';

export function defaultDependencies(): GeneratedArtifactExportDependencies & GeneratedArtifactFolderSaveDependencies {
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
    showFolderDialog: async () => {
      const result = await dialog.showOpenDialog({
        title: 'PDF를 저장할 폴더 선택',
        properties: ['openDirectory', 'createDirectory'],
      });
      return { canceled: result.canceled, filePath: result.filePaths[0] };
    },
    copyFile: (sourcePath, destinationPath) =>
      copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL),
  };
}
