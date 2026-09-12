import type { SearchHit } from '../../platform/knowledge.js';
import { buildSnippet, iterateFolderChunks } from './indexer.js';
import type { IndexedChunk } from './types.js';
import type { LocalFolderEntry } from '../../platform/local-folder-config.js';

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
}

export function searchLocalFolder(
  folder: LocalFolderEntry,
  query: string,
  options?: FolderSearchOptions,
): SearchHit[] {
  const limit = Math.trunc(Math.min(Math.max(options?.limit ?? 8, 1), 20));
  if (!Number.isFinite(limit)) return [];
  const tokens = tokenizeQuery(query);
  if (!tokens.length) return [];

  const ranked: SearchHit[] = [];
  for (const chunk of iterateFolderChunks(folder, { minFileBytes: options?.minFileBytes })) {
    const score = scoreChunk(chunk, tokens);
    if (score <= 0 || (ranked.length === limit && score <= ranked[ranked.length - 1]!.score)) continue;
    ranked.push(toSearchHit(chunk, tokens, score));
    ranked.sort((a, b) => b.score - a.score);
    if (ranked.length > limit) ranked.pop();
  }
  return ranked;
}
