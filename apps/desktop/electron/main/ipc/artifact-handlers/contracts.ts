import type { StoredArtifact } from '@ax-studio/core';

export type GeneratedArtifactExportResult =
  | { ok: true; fileName: string }
  | { ok: false; canceled?: boolean; error?: string };

export interface GeneratedArtifactExportDependencies {
  getArtifact: (artifactId: string) => StoredArtifact | undefined;
  resolveSourcePath: (artifact: StoredArtifact) => Promise<string | undefined>;
  showSaveDialog: (fileName: string) => Promise<{ canceled: boolean; filePath?: string }>;
  copyFile: (sourcePath: string, destinationPath: string) => Promise<void>;
}
