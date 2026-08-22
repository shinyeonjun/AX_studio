import { statSync } from 'node:fs';
import { resolveFileWithinFolderRoot } from '../modules/local-folder/path-security.js';
import type { IndexedChunk } from './types.js';
import { tombstoneFile } from './store.js';

export function isChunkFresh(chunk: IndexedChunk, folderRoot: string): boolean {
  if (chunk.tombstone) return false;
  const resolved = resolveFileWithinFolderRoot(folderRoot, chunk.filePath);
  if (!resolved.ok) return false;
  try {
    const stat = statSync(resolved.path);
    return stat.isFile() && stat.mtime.toISOString() === chunk.modifiedAt && stat.size === chunk.size;
  } catch {
    return false;
  }
}

/** Drop stale rows and tombstone them so later searches skip re-check cost. */
export function filterFreshChunks(chunks: IndexedChunk[], folderRoot: string): IndexedChunk[] {
  const fresh: IndexedChunk[] = [];
  for (const chunk of chunks) {
    if (isChunkFresh(chunk, folderRoot)) {
      fresh.push(chunk);
      continue;
    }
    tombstoneFile(chunk.folderId, chunk.filePath);
  }
  return fresh;
}
