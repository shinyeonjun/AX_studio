import type { DocumentWriteFormatModule } from './types.js';
import { htmlWriteModule } from './html/index.js';
import { docxWriteModule } from './docx/index.js';
import { pdfWriteModule } from './pdf/index.js';

const writeModules: DocumentWriteFormatModule[] = [htmlWriteModule, docxWriteModule, pdfWriteModule];

const writeHandlers = new Map<string, import('../types.js').DocumentActionHandler>();

for (const mod of writeModules) {
  for (const [action, handler] of Object.entries(mod.actions)) {
    writeHandlers.set(`${mod.format}.${action}`, handler);
  }
}

export function getDocumentWriteHandler(action: string): import('../types.js').DocumentActionHandler | undefined {
  return writeHandlers.get(action);
}

export function listDocumentWriteActions(): string[] {
  return [...writeHandlers.keys()];
}
