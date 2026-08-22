import type { SearchHit } from '../platform/knowledge.js';
import { buildSnippet } from './indexer.js';
import { filterFreshChunks } from './stale.js';
import { getFolderIndex, replaceFolderIndex } from './store.js';
import type { IndexedChunk } from './types.js';
import { buildFolderIndex } from './indexer.js';
import type { LocalFolderEntry } from '../modules/local-folder/connection.js';

function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .map((token) => token.trim())
    .filter((token) => token.length >= 2);
}

function scoreChunk(chunk: IndexedChunk, tokens: string[]): number {
  if (!tokens.length) return 0;
  const haystack = chunk.text.toLowerCase();
  let matches = 0;
  for (const token of tokens) {
    if (haystack.includes(token)) matches += 1;
  }
  return matches / tokens.length;
}

function toSearchHit(chunk: IndexedChunk, tokens: string[], score: number): SearchHit {
  return {
    ref: chunk.doc.ref,
    score,
    snippet: buildSnippet(chunk.text, tokens),
  };
}

export interface FolderSearchOptions {
  limit?: number;
  minFileBytes?: number;
  rebuild?: boolean;
}

export function searchLocalFolder(
  folder: LocalFolderEntry,
  query: string,
  options?: FolderSearchOptions,
): SearchHit[] {
  const limit = Math.min(Math.max(options?.limit ?? 8, 1), 20);
  const tokens = tokenizeQuery(query);
  if (!tokens.length) return [];

  let chunks = getFolderIndex(folder.id);
  if (!chunks.length || options?.rebuild === true) {
    chunks = buildFolderIndex(folder, { minFileBytes: options?.minFileBytes });
    replaceFolderIndex(folder.id, chunks);
  }

  const fresh = filterFreshChunks(chunks, folder.path);
  if (fresh.length !== chunks.length) {
    replaceFolderIndex(folder.id, fresh);
  }

  const ranked = fresh
    .map((chunk) => ({ chunk, score: scoreChunk(chunk, tokens) }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  return ranked.map((entry) => toSearchHit(entry.chunk, tokens, entry.score));
}
