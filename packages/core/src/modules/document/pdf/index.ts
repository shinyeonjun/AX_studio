import type { DocumentFormatModule } from '../types.js';
import { pdfGenerate } from './generate.js';

export const pdfDocument: DocumentFormatModule = {
  format: 'pdf',
  actions: {
    generate: pdfGenerate,
  },
};
