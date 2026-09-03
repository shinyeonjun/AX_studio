import type { DocumentWriteFormatModule } from '../types.js';
import { pdfGenerate } from './generate.js';
import { pdfFormAnalyze } from './form-analyze.js';
import { pdfFormFill } from './form-fill.js';
import { pdfToHtml } from './to-html.js';

export const pdfWriteModule: DocumentWriteFormatModule = {
  format: 'pdf',
  actions: {
    generate: pdfGenerate,
    'form.analyze': pdfFormAnalyze,
    'form.fill': pdfFormFill,
    toHtml: pdfToHtml,
  },
};
