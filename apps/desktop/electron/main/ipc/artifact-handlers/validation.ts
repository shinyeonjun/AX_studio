import { generatedFileTypeOf, type StoredArtifact } from '@ax-studio/core';
import type { GeneratedArtifactSourceDependencies } from './contracts.js';
import { safeExportFileName } from './filename.js';

export interface ValidatedGeneratedArtifact {
  artifact: StoredArtifact;
  sourcePath: string;
  fileName: string;
}

export type GeneratedArtifactValidationResult =
  | ({ ok: true } & ValidatedGeneratedArtifact)
  | { ok: false; error: string };

/** Resolve one host-owned generated file (PDF, xlsx, docx) while keeping paths out of renderer-facing results. */
export async function resolveGeneratedArtifact(
  artifactId: unknown,
  deps: GeneratedArtifactSourceDependencies,
): Promise<GeneratedArtifactValidationResult> {
  if (typeof artifactId !== 'string' || !artifactId.trim()) {
    return { ok: false, error: '생성 결과물 ID가 필요합니다.' };
  }

  let artifact: StoredArtifact | undefined;
  try {
    artifact = deps.getArtifact(artifactId.trim());
  } catch {
    return { ok: false, error: '생성 결과물을 찾을 수 없습니다.' };
  }
  if (!artifact) return { ok: false, error: '생성 결과물을 찾을 수 없습니다.' };
  // A PDF has always been accepted by its type alone; other kinds also need a matching name.
  if (artifact.mimeType !== 'application/pdf' && !generatedFileTypeOf(artifact.mimeType ?? '', artifact.fileName)) {
    return { ok: false, error: '생성 결과물 형식이 올바르지 않습니다.' };
  }

  let sourcePath: string | undefined;
  try {
    sourcePath = await deps.resolveSourcePath(artifact);
  } catch {
    sourcePath = undefined;
  }
  if (!sourcePath) return { ok: false, error: '생성 결과물을 찾을 수 없습니다.' };

  return {
    ok: true,
    artifact,
    sourcePath,
    fileName: safeExportFileName(artifact.fileName),
  };
}

export function isDestinationConflict(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST');
}
