import type { SearchHit } from '../platform/knowledge.js';

export const MAX_CLOUD_SNIPPET_CHARS = 240;

export function applySnippetPolicy(
  hits: SearchHit[],
  options: { allowFullContent: boolean },
): SearchHit[] {
  if (options.allowFullContent) return hits;
  return hits.map((hit) => ({
    ...hit,
    snippet: hit.snippet ? hit.snippet.slice(0, MAX_CLOUD_SNIPPET_CHARS) : undefined,
  }));
}
