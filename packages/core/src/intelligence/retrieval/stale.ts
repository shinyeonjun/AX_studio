import { statSync } from 'node:fs';
import { resolveFileWithinFolderRoot } from '../../platform/local-folder-path.js';
import type { IndexedChunk } from './types.js';

export function isChunkFresh(chunk: IndexedChunk, folderRoot: string): boolean {
  const resolved = resolveFileWithinFolderRoot(folderRoot, chunk.filePath);
  if (!resolved.ok) return false;
  try {
    const stat = statSync(resolved.path);
    return stat.isFile() && stat.mtime.toISOString() === chunk.modifiedAt && stat.size === chunk.size;
  } catch {
    return false;
  }
}
