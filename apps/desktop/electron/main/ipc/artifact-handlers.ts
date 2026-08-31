import { dialog } from 'electron';
import { copyFile, realpath, stat } from 'node:fs/promises';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { ArtifactStore, getAxDataPaths, type StoredArtifact } from '@ax-studio/core';
import { ipcHandle } from './ipc-handle.js';

export type GeneratedArtifactExportResult =
  | { ok: true; fileName: string }
  | { ok: false; canceled?: boolean; error?: string };

export interface GeneratedArtifactExportDependencies {
  getArtifact: (artifactId: string) => StoredArtifact | undefined;
  resolveSourcePath: (artifact: StoredArtifact) => Promise<string | undefined>;
  showSaveDialog: (fileName: string) => Promise<{ canceled: boolean; filePath?: string }>;
  copyFile: (sourcePath: string, destinationPath: string) => Promise<void>;
}

function safeExportFileName(fileName: string): string {
  const leaf = fileName.replace(/^.*[\\/]/, '');
  const sanitized = leaf
    .replace(/[\u0000-\u001f\u007f]/g, '_')
    .replace(/[<>:"|?*]/g, '_')
    .trim()
    .replace(/[. ]+$/g, '')
    .slice(0, 180);
  return sanitized && sanitized !== '.' && sanitized !== '..' ? sanitized : 'report.pdf';
}

function isWithinRoot(rootDir: string, filePath: string): boolean {
  const relativePath = relative(resolve(rootDir), resolve(filePath));
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

export async function resolveGeneratedArtifactSourcePath(
  rootDir: string,
  storedPath: string,
  expectedSize: number,
): Promise<string | undefined> {
  try {
    const [realRoot, realFile] = await Promise.all([realpath(rootDir), realpath(storedPath)]);
    if (!isWithinRoot(realRoot, realFile)) return undefined;
    const fileStat = await stat(realFile);
    if (!fileStat.isFile() || fileStat.size !== expectedSize) return undefined;
    return realFile;
  } catch {
    return undefined;
  }
}

export async function exportGeneratedArtifact(
  artifactId: unknown,
  deps: GeneratedArtifactExportDependencies,
): Promise<GeneratedArtifactExportResult> {
  if (typeof artifactId !== 'string' || !artifactId.trim()) {
    return { ok: false, error: 'PDF 결과물 ID가 필요합니다.' };
  }

  let artifact: StoredArtifact | undefined;
  try {
    artifact = deps.getArtifact(artifactId.trim());
  } catch {
    return { ok: false, error: 'PDF 결과물을 찾을 수 없습니다.' };
  }
  if (!artifact) return { ok: false, error: 'PDF 결과물을 찾을 수 없습니다.' };
  if (artifact.mimeType !== 'application/pdf') {
    return { ok: false, error: 'PDF 결과물 형식이 올바르지 않습니다.' };
  }

  let sourcePath: string | undefined;
  try {
    sourcePath = await deps.resolveSourcePath(artifact);
  } catch {
    sourcePath = undefined;
  }
  if (!sourcePath) return { ok: false, error: 'PDF 결과물을 찾을 수 없습니다.' };

  const fileName = safeExportFileName(artifact.fileName);
  let saveResult: { canceled: boolean; filePath?: string };
  try {
    saveResult = await deps.showSaveDialog(fileName);
  } catch {
    return { ok: false, error: 'PDF 저장 대화상자를 열지 못했습니다.' };
  }
  if (saveResult.canceled || !saveResult.filePath) return { ok: false, canceled: true };

  try {
    await deps.copyFile(sourcePath, saveResult.filePath);
  } catch {
    return { ok: false, error: 'PDF 저장에 실패했습니다.' };
  }
  return { ok: true, fileName: safeExportFileName(saveResult.filePath) };
}

function defaultDependencies(): GeneratedArtifactExportDependencies {
  const store = new ArtifactStore(getAxDataPaths().generated.reports);
  return {
    getArtifact: (artifactId) => store.get(artifactId),
    resolveSourcePath: (artifact) =>
      resolveGeneratedArtifactSourcePath(store.root, artifact.storedPath, artifact.size),
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

export function registerArtifactHandlers(): void {
  ipcHandle('ax:exportGeneratedArtifact', async (_event, artifactId: unknown) =>
    exportGeneratedArtifact(artifactId, defaultDependencies()),
  );
}
