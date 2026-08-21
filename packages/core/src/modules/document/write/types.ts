import type { DocumentWriteFormat } from '../../../document-write/types.js';
import type { DocumentActionHandler } from '../types.js';

export interface DocumentWriteFormatModule {
  format: DocumentWriteFormat;
  /** action suffix after `${format}.` — e.g. render, fill, generate */
  actions: Record<string, DocumentActionHandler>;
}
