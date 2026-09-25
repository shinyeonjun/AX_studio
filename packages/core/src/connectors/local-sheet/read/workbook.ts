import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { DEFAULT_TABLE_ROW_LIMIT } from '../profile.js';
import type { ReadWorkbookResult } from './contracts.js';
import { readCsvWorkbook } from './csv.js';
import { assertWorkbookByteLength, assertWorkbookSize, fileRefForPath } from './shared.js';

export async function readWorkbookFromPath(path: string, options: { rowLimit?: number } = {}): Promise<ReadWorkbookResult> {
  // Keep the cheap metadata guard before loading an untrusted file into memory.
  assertWorkbookSize(path);
  const data = readFileSync(path);
  assertWorkbookByteLength(data.byteLength);
  const rowLimit = options.rowLimit ?? DEFAULT_TABLE_ROW_LIMIT;
  const ext = extname(path).toLowerCase();
  const workbookId = `wb_${createHash('sha256').update(data).digest('hex').slice(0, 16)}`;
  const file = fileRefForPath(path);
  const input = { path, rowLimit, workbookId, file, data };

  if (ext === '.csv') return readCsvWorkbook(input);
  const { readXlsxWorkbook } = await import('./xlsx.js');
  return readXlsxWorkbook(input);
}
