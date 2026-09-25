import Docxtemplater from 'docxtemplater';
import PizZip from 'pizzip';
import { readFileSync, statSync } from 'node:fs';
import type { DocxFillInput, DocxFillResult } from '../types.js';

const MAX_DOCX_TEMPLATE_BYTES = 50 * 1024 * 1024;
const MAX_DOCX_ZIP_ENTRIES = 10_000;
const MAX_DOCX_UNCOMPRESSED_BYTES = 200 * 1024 * 1024;

function validateDocxZip(content: Buffer): void {
  if (content.length < 22) throw new Error('docx_invalid_zip');
  const minimumEndOffset = Math.max(0, content.length - 65_557);
  let endOffset = -1;
  for (let offset = content.length - 22; offset >= minimumEndOffset; offset -= 1) {
    if (content.readUInt32LE(offset) === 0x06054b50) {
      endOffset = offset;
      break;
    }
  }
  if (endOffset < 0) throw new Error('docx_invalid_zip');

  const entryCount = content.readUInt16LE(endOffset + 10);
  const centralDirectorySize = content.readUInt32LE(endOffset + 12);
  const centralDirectoryOffset = content.readUInt32LE(endOffset + 16);
  if (entryCount === 0xffff || centralDirectorySize === 0xffffffff || centralDirectoryOffset === 0xffffffff) {
    throw new Error('docx_zip64_unsupported');
  }
  if (entryCount > MAX_DOCX_ZIP_ENTRIES
    || centralDirectoryOffset + centralDirectorySize > content.length) {
    throw new Error('docx_zip_too_large');
  }

  let cursor = centralDirectoryOffset;
  let uncompressedBytes = 0;
  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > content.length || content.readUInt32LE(cursor) !== 0x02014b50) {
      throw new Error('docx_invalid_zip');
    }
    const compressedBytes = content.readUInt32LE(cursor + 20);
    const uncompressedEntryBytes = content.readUInt32LE(cursor + 24);
    const nameLength = content.readUInt16LE(cursor + 28);
    const extraLength = content.readUInt16LE(cursor + 30);
    const commentLength = content.readUInt16LE(cursor + 32);
    const recordLength = 46 + nameLength + extraLength + commentLength;
    if (cursor + recordLength > content.length) throw new Error('docx_invalid_zip');
    uncompressedBytes += uncompressedEntryBytes;
    if (uncompressedBytes > MAX_DOCX_UNCOMPRESSED_BYTES
      || uncompressedEntryBytes > compressedBytes * 100 + 1_048_576) {
      throw new Error('docx_zip_too_large');
    }
    cursor += recordLength;
  }
}

export function fillDocx(input: DocxFillInput): DocxFillResult {
  if (statSync(input.templatePath).size > MAX_DOCX_TEMPLATE_BYTES) throw new Error('docx_template_too_large');
  const content = readFileSync(input.templatePath);
  validateDocxZip(content);
  const zip = new PizZip(content);
  const doc = new Docxtemplater(zip, { paragraphLoop: true, linebreaks: true });
  doc.render(input.data);
  const buffer = doc.getZip().generate({ type: 'nodebuffer' });
  return { buffer, size: buffer.length };
}
