import type { StoredArtifact } from '@ax-studio/core';
import type { GeneratedArtifactExportDependencies, GeneratedArtifactExportResult } from './contracts.js';
import { safeExportFileName } from './filename.js';

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
