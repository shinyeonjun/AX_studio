export type GeneratedArtifactExportResult =
  | { ok: true; fileName: string }
  | { ok: false; canceled?: boolean; error?: string };

export type GeneratedArtifactFolderSaveResult = GeneratedArtifactExportResult;
