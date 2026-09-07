import type { DocumentActionHandler } from './types.js';
import { ingest } from './read/actions/ingest.js';
import { getChunk } from './read/actions/get-chunk.js';
import { getPage } from './read/actions/get-page.js';
import { search } from './read/actions/search.js';
import { getDocumentWriteHandler, listDocumentWriteActions } from './write/registry.js';

const readActions: Record<string, DocumentActionHandler> = {
  ingest,
  getChunk,
  getPage,
  search,
};

export function getDocumentHandler(action: string): DocumentActionHandler | undefined {
  return readActions[action] ?? getDocumentWriteHandler(action);
}

export function listDocumentActions(): string[] {
  return [...Object.keys(readActions), ...listDocumentWriteActions()];
}
