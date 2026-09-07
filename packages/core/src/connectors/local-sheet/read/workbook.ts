import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import { DEFAULT_TABLE_ROW_LIMIT } from '../profile.js';
import type { ReadWorkbookResult } from './contracts.js';
import { readCsvWorkbook } from './csv.js';
import { fileRefForPath } from './shared.js';
import { readXlsxWorkbook } from './xlsx.js';

export function readWorkbookFromPath(path: string, options: { rowLimit?: number } = {}): ReadWorkbookResult {
  const rowLimit = options.rowLimit ?? DEFAULT_TABLE_ROW_LIMIT;
  const ext = extname(path).toLowerCase();
  const workbookId = `wb_${createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)}`;
  const file = fileRefForPath(path);
  const input = { path, rowLimit, workbookId, file };

  return ext === '.csv' ? readCsvWorkbook(input) : readXlsxWorkbook(input);
}
