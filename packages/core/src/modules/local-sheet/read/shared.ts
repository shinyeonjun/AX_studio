import { basename, extname } from 'node:path';
import * as XLSX from 'xlsx';
import type { FileRef } from '../../../contracts/artifacts/file-ref.js';
import { fileRefFromLocalScan } from '../../../contracts/artifacts/file-ref.js';

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
