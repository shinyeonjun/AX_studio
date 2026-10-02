import type { GeneratedArtifactExportDependencies, GeneratedArtifactExportResult } from './contracts.js';
import { safeExportFileName } from './filename.js';
import { isDestinationConflict, resolveGeneratedArtifact } from './validation.js';

export async function exportGeneratedArtifact(
  artifactId: unknown,
  deps: GeneratedArtifactExportDependencies,
): Promise<GeneratedArtifactExportResult> {
  const source = await resolveGeneratedArtifact(artifactId, deps);
  if (!source.ok) return source;
  let saveResult: { canceled: boolean; filePath?: string };
  try {
    saveResult = await deps.showSaveDialog(source.fileName);
  } catch {
    return { ok: false, error: '결과물 저장 대화상자를 열지 못했습니다.' };
  }
  if (saveResult.canceled || !saveResult.filePath) return { ok: false, canceled: true };

  try {
    await deps.copyFile(source.sourcePath, saveResult.filePath);
  } catch (error) {
    if (isDestinationConflict(error)) {
      return { ok: false, error: '같은 이름의 파일이 이미 있어 덮어쓰지 않았습니다.' };
    }
    return { ok: false, error: '결과물 저장에 실패했습니다.' };
  }
  return { ok: true, fileName: safeExportFileName(saveResult.filePath) };
}
