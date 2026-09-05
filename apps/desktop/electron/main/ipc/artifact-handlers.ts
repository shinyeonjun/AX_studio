import { ipcHandle } from './ipc-handle.js';
import { defaultDependencies } from './artifact-handlers/dependencies.js';
import { exportGeneratedArtifact } from './artifact-handlers/export.js';
import { saveGeneratedArtifactToFolder } from './artifact-handlers/folder.js';

export type {
  GeneratedArtifactExportDependencies,
  GeneratedArtifactExportResult,
  GeneratedArtifactFolderSaveDependencies,
  GeneratedArtifactFolderSaveResult,
} from './artifact-handlers/contracts.js';
export { resolveGeneratedArtifactSourcePath } from './artifact-handlers/source.js';
export { exportGeneratedArtifact } from './artifact-handlers/export.js';
export { saveGeneratedArtifactToFolder } from './artifact-handlers/folder.js';

export function registerArtifactHandlers(): void {
  ipcHandle('ax:exportGeneratedArtifact', async (_event, artifactId: unknown) =>
    exportGeneratedArtifact(artifactId, defaultDependencies()),
  );
  ipcHandle('ax:saveGeneratedArtifactToFolder', async (_event, artifactId: unknown) =>
    saveGeneratedArtifactToFolder(artifactId, defaultDependencies()),
  );
}
