import { openSync, readSync, closeSync } from 'node:fs';
import type { LocalFolderEntry } from '../../platform/local-folder-config.js';
import { resolveFolderRoot } from '../../platform/local-folder-path.js';
import { scanFolder } from '../../platform/local-folder-scan.js';
import { localFileSourceRef } from './file-ref.js';
import type { IndexedChunk } from './types.js';
import { isChunkFresh } from './stale.js';

const INDEXABLE_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.json', '.csv', '.log']);
const MAX_FILE_BYTES_FOR_INDEX = 512_000;
const MAX_CHUNK_CHARS = 2_000;

function readBoundedText(filePath: string): string | null {
  let fd: number | undefined;
  try {
    fd = openSync(filePath, 'r');
    const raw = Buffer.allocUnsafe(MAX_FILE_BYTES_FOR_INDEX);
    let length = 0;
    while (length < raw.length) {
      const count = readSync(fd, raw, length, raw.length - length, length);
      if (count === 0) break;
      length += count;
    }
    return raw.subarray(0, length).toString('utf8');
  } catch {
    return null;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

function excerptAroundMatch(text: string, tokens: string[]): string {
  const lower = text.toLowerCase();
  for (const token of tokens) {
    const index = lower.indexOf(token);
    if (index >= 0) {
      const start = Math.max(0, index - 80);
      const end = Math.min(text.length, index + token.length + 120);
      return text.slice(start, end).trim();
    }
  }
  return text.slice(0, MAX_CHUNK_CHARS).trim();
}

export function buildSnippet(text: string, tokens: string[]): string {
  return excerptAroundMatch(text, tokens).slice(0, MAX_CHUNK_CHARS);
}

export function* iterateFolderChunks(
  folder: LocalFolderEntry,
  options?: { minFileBytes?: number },
): Generator<IndexedChunk> {
  const root = resolveFolderRoot(folder.path);
  if (!root.ok) return;

  const minFileBytes = options?.minFileBytes ?? 0;
  const scanned = scanFolder(folder.path);
  const indexedAt = new Date().toISOString();

  for (const file of scanned) {
    if (!INDEXABLE_EXTENSIONS.has(file.extension)) continue;
    if (file.size < minFileBytes) continue;

    const text = readBoundedText(file.filePath);
    if (!text?.trim()) continue;

    const chunk: IndexedChunk = {
      folderId: folder.id,
      filePath: file.filePath,
      fileName: file.fileName,
      modifiedAt: file.modifiedAt,
      size: file.size,
      text,
      doc: {
        ref: localFileSourceRef(folder.id, file.filePath, file.fileName),
        indexedAt,
        staleAfter: file.modifiedAt,
      },
    };
    if (isChunkFresh(chunk, folder.path)) yield chunk;
  }

}
