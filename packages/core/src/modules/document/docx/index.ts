import type { DocumentFormatModule } from '../types.js';
import { docxFill } from './fill.js';

export const docxDocument: DocumentFormatModule = {
  format: 'docx',
  actions: {
    fill: docxFill,
  },
};
