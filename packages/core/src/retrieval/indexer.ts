import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import type { LocalFolderEntry } from '../modules/local-folder/connection.js';
import { resolveFolderRoot } from '../modules/local-folder/path-security.js';
import { scanFolder } from '../modules/local-folder/scan.js';
import { localFileSourceRef } from './file-ref.js';
import type { IndexedChunk } from './types.js';

const INDEXABLE_EXTENSIONS = new Set(['.txt', '.md', '.markdown', '.json', '.csv', '.log']);
const MAX_FILE_BYTES_FOR_INDEX = 512_000;
const MAX_CHUNK_CHARS = 2_000;

function readBoundedText(filePath: string): string | null {
  try {
    const raw = readFileSync(filePath);
    if (raw.byteLength > MAX_FILE_BYTES_FOR_INDEX) {
      return raw.subarray(0, MAX_FILE_BYTES_FOR_INDEX).toString('utf8');
    }
    return raw.toString('utf8');
  } catch {
    return null;
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

export function buildFolderIndex(
  folder: LocalFolderEntry,
  options?: { minFileBytes?: number },
): IndexedChunk[] {
  const root = resolveFolderRoot(folder.path);
  if (!root.ok) return [];

  const minFileBytes = options?.minFileBytes ?? 0;
  const scanned = scanFolder(folder.path);
  const indexedAt = new Date().toISOString();
  const chunks: IndexedChunk[] = [];

  for (const file of scanned) {
    if (!INDEXABLE_EXTENSIONS.has(file.extension)) continue;
    if (file.size < minFileBytes) continue;

    const text = readBoundedText(file.filePath);
    if (!text?.trim()) continue;

    chunks.push({
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
    });
  }

  return chunks;
}

export { excerptAroundMatch };
