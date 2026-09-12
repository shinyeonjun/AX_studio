import { statSync } from 'node:fs';
import { basename, extname } from 'node:path';
import * as XLSX from 'xlsx';
import type { FileRef } from '../../../contracts/artifacts/file-ref.js';
import { fileRefFromLocalScan } from '../../../contracts/artifacts/file-ref.js';
import { MAX_WORKBOOK_BYTES } from '../profile.js';

export function assertWorkbookSize(path: string): void {
  const size = statSync(path).size;
  if (size > MAX_WORKBOOK_BYTES) {
    throw new Error(`스프레드시트 파일이 너무 큽니다. ${Math.round(MAX_WORKBOOK_BYTES / (1024 * 1024))}MB 이하만 읽을 수 있습니다.`);
  }
}

export function fileRefForPath(path: string): FileRef {
  const name = basename(path);
  return fileRefFromLocalScan({
    filePath: path,
    fileName: name,
    extension: extname(name),
  });
}

export function sheetToMatrix(sheet: XLSX.WorkSheet): { headers: string[]; matrix: unknown[][] } {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null }) as unknown[][];
  if (rows.length === 0) return { headers: [], matrix: [] };
  const headers = (rows[0] ?? []).map((cell, index) => String(cell ?? `column_${index + 1}`));
  return { headers, matrix: rows.slice(1) };
}

export function sheetVisibility(hidden: number | undefined): 'visible' | 'hidden' | 'veryHidden' {
  if (hidden === 1) return 'hidden';
  if (hidden === 2) return 'veryHidden';
  return 'visible';
}
