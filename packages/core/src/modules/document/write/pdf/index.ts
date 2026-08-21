import type { DocumentWriteFormatModule } from '../types.js';
import { pdfGenerate } from './generate.js';
import { pdfToHtml } from './to-html.js';

export const pdfWriteModule: DocumentWriteFormatModule = {
  format: 'pdf',
  actions: {
    generate: pdfGenerate,
    toHtml: pdfToHtml,
  },
};
