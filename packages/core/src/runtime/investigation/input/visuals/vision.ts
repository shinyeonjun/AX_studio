import { readFile, realpath } from 'node:fs/promises';
import { basename, extname, isAbsolute, relative } from 'node:path';
import { defaultArtifactRoot } from '../../../../documents/read/paths.js';
import { getAxDataPaths } from '../../../../persistence/paths/ax-data.js';
import type { ModelImageInput } from '../../../../intelligence/agent/model/provider.js';
import { documentVisualReferencesFromRun } from './references.js';

function imageMimeType(path: string): string | undefined {
  const extension = extname(path).toLowerCase();
  return {
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png': 'image/png',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
  }[extension];
}

/** Directories the document engine and artifact store write page images into. */
function visionAssetRoots(): string[] {
  return [defaultArtifactRoot(), getAxDataPaths().artifacts];
}

async function realRoots(roots: readonly string[]): Promise<string[]> {
  const resolved = await Promise.all(roots.map((root) => realpath(root).catch(() => undefined)));
  return resolved.filter((root): root is string => typeof root === 'string');
}

function isInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path !== '' && !path.startsWith('..') && !isAbsolute(path);
}

/**
 * Image paths come from step results, which can carry provider or user data.
 * Only read files whose real path (after symlinks) is inside an artifact root.
 */
async function containedAssetPath(path: string, roots: readonly string[]): Promise<string> {
  let resolved: string | undefined;
  try {
    resolved = await realpath(path);
  } catch {
    resolved = undefined;
  }
  if (!resolved || !roots.some((root) => isInside(root, resolved))) {
    throw Object.assign(new Error(`PDF 시각 아티팩트 경로가 허용된 데이터 폴더 밖에 있습니다: ${path}`), {
      code: 'vision_asset_outside_artifact_root',
      path,
    });
  }
  return resolved;
}

export async function visionInputsFromRun(
  variables: Record<string, unknown>,
  stepResults: Record<string, unknown>,
): Promise<ModelImageInput[]> {
  const references = documentVisualReferencesFromRun(variables, stepResults);
  const images: ModelImageInput[] = [];
  let totalBytes = 0;
  const maxImageBytes = 8 * 1024 * 1024;
  const maxTotalBytes = 32 * 1024 * 1024;
  const roots = references.length > 0 ? await realRoots(visionAssetRoots()) : [];

  for (const reference of references) {
    const mimeType = imageMimeType(reference.path);
    if (!mimeType) {
      throw Object.assign(new Error(`지원하지 않는 PDF 이미지 형식입니다: ${reference.path}`), {
        code: 'vision_unsupported_media',
        path: reference.path,
      });
    }
    const assetPath = await containedAssetPath(reference.path, roots);
    let data: Buffer;
    try {
      data = await readFile(assetPath);
    } catch (error) {
      throw Object.assign(new Error(`PDF 시각 아티팩트 이미지를 읽을 수 없습니다: ${reference.path}`), {
        code: 'vision_asset_unavailable',
        path: reference.path,
        cause: error,
      });
    }
    if (data.length === 0 || data.length > maxImageBytes || totalBytes + data.length > maxTotalBytes) {
      throw Object.assign(new Error(`PDF 시각 입력 크기가 허용 범위를 초과했습니다: ${reference.path}`), {
        code: 'vision_input_too_large',
        path: reference.path,
      });
    }
    totalBytes += data.length;
    images.push({
      data: new Uint8Array(data),
      mimeType,
      pageIndex: reference.pageIndex,
      filename: basename(reference.path),
    });
  }
  return images;
}
