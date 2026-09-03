import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';
import type { ModelImageInput } from '../../../../agent/model/provider.js';
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

export async function visionInputsFromRun(
  variables: Record<string, unknown>,
  stepResults: Record<string, unknown>,
): Promise<ModelImageInput[]> {
  const references = documentVisualReferencesFromRun(variables, stepResults);
  const images: ModelImageInput[] = [];
  let totalBytes = 0;
  const maxImageBytes = 8 * 1024 * 1024;
  const maxTotalBytes = 32 * 1024 * 1024;

  for (const reference of references) {
    const mimeType = imageMimeType(reference.path);
    if (!mimeType) {
      throw Object.assign(new Error(`지원하지 않는 PDF 이미지 형식입니다: ${reference.path}`), {
        code: 'vision_unsupported_media',
        path: reference.path,
      });
    }
    let data: Buffer;
    try {
      data = await readFile(reference.path);
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
