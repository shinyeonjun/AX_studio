import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { readFileSync } from 'node:fs';
import type { DocxFillInput, DocxFillResult } from '../types.js';

export function fillDocx(input: DocxFillInput): DocxFillResult {
  const content = readFileSync(input.templatePath);
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
  doc.render(input.data);
  const buffer = doc.getZip().generate({ type: 'nodebuffer' });
  return { buffer, size: buffer.length };
}
