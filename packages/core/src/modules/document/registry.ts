import type { DocumentActionHandler, DocumentFormatModule } from './types.js';
import { htmlDocument } from './html/index.js';
import { docxDocument } from './docx/index.js';
import { pdfDocument } from './pdf/index.js';
import { ingest, getChunk, getPage, search } from './engine/index.js';

const modules: DocumentFormatModule[] = [htmlDocument, docxDocument, pdfDocument];

const handlers = new Map<string, DocumentActionHandler>();
const globalActions: Record<string, DocumentActionHandler> = {
  ingest,
  getChunk,
  getPage,
  search,
};

for (const mod of modules) {
  for (const [action, handler] of Object.entries(mod.actions)) {
    handlers.set(`${mod.format}.${action}`, handler);
  }
}

export function getDocumentHandler(action: string): DocumentActionHandler | undefined {
  return globalActions[action] ?? handlers.get(action);
}

export function listDocumentActions(): string[] {
  return [...Object.keys(globalActions), ...handlers.keys()];
}
