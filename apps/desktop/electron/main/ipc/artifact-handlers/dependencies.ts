import { dialog } from 'electron';
import { constants } from 'node:fs';
import { copyFile } from 'node:fs/promises';
import { ArtifactStore, GENERATED_FILE_TYPES, getAxDataPaths, type StoredArtifact } from '@ax-studio/core';
import type {
  GeneratedArtifactExportDependencies,
  GeneratedArtifactFolderSaveDependencies,
} from './contracts.js';
import { resolveGeneratedArtifactSourcePath } from './source.js';

/** The save dialog offers the kind of file being saved, told by its name. */
function saveFilter(fileName: string): { name: string; extensions: string[] } {
  const type = Object.values(GENERATED_FILE_TYPES).find((entry) => fileName.toLowerCase().endsWith(`.${entry.extension}`))
    ?? GENERATED_FILE_TYPES.pdf;
  return { name: type.label, extensions: [type.extension] };
}

export function defaultDependencies(): GeneratedArtifactExportDependencies & GeneratedArtifactFolderSaveDependencies {
  const store = new ArtifactStore(getAxDataPaths().generated.reports);
  return {
    getArtifact: (artifactId) => store.get(artifactId),
    resolveSourcePath: (artifact: StoredArtifact) =>
      resolveGeneratedArtifactSourcePath(store.root, artifact.storedPath, artifact.size, artifact.sha256),
    showSaveDialog: async (fileName) => {
      const result = await dialog.showSaveDialog({
        title: '결과물 저장',
        defaultPath: fileName,
        filters: [saveFilter(fileName)],
      });
      return { canceled: result.canceled, filePath: result.filePath };
    },
    showFolderDialog: async () => {
      const result = await dialog.showOpenDialog({
        title: '결과물을 저장할 폴더 선택',
        properties: ['openDirectory', 'createDirectory'],
      });
      return { canceled: result.canceled, filePath: result.filePaths[0] };
    },
    copyFile: (sourcePath, destinationPath) =>
      copyFile(sourcePath, destinationPath, constants.COPYFILE_EXCL),
  };
}
