import type { DocumentActionHandler } from './types.js';
import { ingest, getChunk, getPage, search } from './read/index.js';
import { getDocumentWriteHandler, listDocumentWriteActions } from './write/index.js';

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
