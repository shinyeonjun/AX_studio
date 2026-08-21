import type { DocumentWriteFormatModule } from '../types.js';
import { docxFill } from './fill.js';

export const docxWriteModule: DocumentWriteFormatModule = {
  format: 'docx',
  actions: {
    fill: docxFill,
  },
};
