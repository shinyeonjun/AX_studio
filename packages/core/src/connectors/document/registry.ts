import type { DocumentActionHandler } from './types.js';
import { ingest } from './read/actions/ingest.js';
import { getChunk } from './read/actions/get-chunk.js';
import { getPage } from './read/actions/get-page.js';
import { search } from './read/actions/search.js';
import { getDocumentWriteHandler, listDocumentWriteActions } from './write/registry.js';

// A Map, not an object literal: action names come from workflows, and
// `constructor`/`__proto__` must not resolve to Object.prototype members.
const readActions = new Map<string, DocumentActionHandler>([
  ['ingest', ingest],
  ['getChunk', getChunk],
  ['getPage', getPage],
  ['search', search],
]);

export async function getDocumentHandler(action: string): Promise<DocumentActionHandler | undefined> {
  return readActions.get(action) ?? getDocumentWriteHandler(action);
}

export function listDocumentActions(): string[] {
  return [...readActions.keys(), ...listDocumentWriteActions()];
}
