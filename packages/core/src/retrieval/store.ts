import type { IndexedChunk } from './types.js';

const folderIndexes = new Map<string, IndexedChunk[]>();

export function getFolderIndex(folderId: string): IndexedChunk[] {
  return folderIndexes.get(folderId) ?? [];
}

export function replaceFolderIndex(folderId: string, chunks: IndexedChunk[]): void {
  folderIndexes.set(folderId, chunks);
}

export function purgeFolderIndex(folderId: string): void {
  folderIndexes.delete(folderId);
}

export function tombstoneFile(folderId: string, filePath: string): void {
  const chunks = folderIndexes.get(folderId);
  if (!chunks) return;
  for (const chunk of chunks) {
    if (chunk.filePath === filePath) chunk.tombstone = true;
  }
}

/** Test-only reset. */
export function clearRetrievalStoreForTests(): void {
  folderIndexes.clear();
}
