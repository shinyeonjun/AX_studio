import { join } from 'node:path';
import type {
  GeneratedArtifactFolderSaveDependencies,
  GeneratedArtifactFolderSaveResult,
} from './contracts.js';
import { isDestinationConflict, resolveGeneratedPdfArtifact } from './validation.js';

/** Save a validated generated PDF into a folder explicitly chosen by the user. */
export async function saveGeneratedArtifactToFolder(
  artifactId: unknown,
  deps: GeneratedArtifactFolderSaveDependencies,
): Promise<GeneratedArtifactFolderSaveResult> {
  const source = await resolveGeneratedPdfArtifact(artifactId, deps);
  if (!source.ok) return source;

  let folderResult: { canceled: boolean; filePath?: string };
  try {
    folderResult = await deps.showFolderDialog();
  } catch {
    return { ok: false, error: 'PDF 저장 폴더 선택창을 열지 못했습니다.' };
  }
  if (folderResult.canceled) return { ok: false, canceled: true };
  if (!folderResult.filePath) return { ok: false, error: 'PDF 저장 폴더를 선택하지 못했습니다.' };

  try {
    await deps.copyFile(source.sourcePath, join(folderResult.filePath, source.fileName));
  } catch (error) {
    if (isDestinationConflict(error)) {
      return { ok: false, error: '같은 이름의 PDF가 이미 있어 덮어쓰지 않았습니다.' };
    }
    return { ok: false, error: 'PDF 저장에 실패했습니다.' };
  }
  return { ok: true, fileName: source.fileName };
}
