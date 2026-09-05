import type { StoredArtifact } from '@ax-studio/core';

export type GeneratedArtifactExportResult =
  | { ok: true; fileName: string }
  | { ok: false; canceled?: boolean; error?: string };

export type GeneratedArtifactFolderSaveResult = GeneratedArtifactExportResult;

export interface GeneratedArtifactSourceDependencies {
  getArtifact: (artifactId: string) => StoredArtifact | undefined;
  resolveSourcePath: (artifact: StoredArtifact) => Promise<string | undefined>;
}

export interface GeneratedArtifactExportDependencies extends GeneratedArtifactSourceDependencies {
  showSaveDialog: (fileName: string) => Promise<{ canceled: boolean; filePath?: string }>;
  /** The default host implementation uses COPYFILE_EXCL; tests can provide a simple copier. */
  copyFile: (sourcePath: string, destinationPath: string) => Promise<void>;
}

export interface GeneratedArtifactFolderSaveDependencies extends GeneratedArtifactSourceDependencies {
  showFolderDialog: () => Promise<{ canceled: boolean; filePath?: string }>;
  /** The default host implementation uses COPYFILE_EXCL; tests can provide a simple copier. */
  copyFile: (sourcePath: string, destinationPath: string) => Promise<void>;
}
