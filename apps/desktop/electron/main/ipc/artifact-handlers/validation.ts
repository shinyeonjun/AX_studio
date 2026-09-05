import type { StoredArtifact } from '@ax-studio/core';
import type { GeneratedArtifactSourceDependencies } from './contracts.js';
import { safeExportFileName } from './filename.js';

export interface ValidatedPdfArtifact {
  artifact: StoredArtifact;
  sourcePath: string;
  fileName: string;
}

export type GeneratedArtifactValidationResult =
  | ({ ok: true } & ValidatedPdfArtifact)
  | { ok: false; error: string };

/** Resolve one host-owned PDF while keeping paths out of renderer-facing results. */
export async function resolveGeneratedPdfArtifact(
  artifactId: unknown,
  deps: GeneratedArtifactSourceDependencies,
): Promise<GeneratedArtifactValidationResult> {
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
