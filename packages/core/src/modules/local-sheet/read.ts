import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import * as XLSX from 'xlsx';
import type { FileRef } from '../../contracts/artifacts/file-ref.js';
import type { TableArtifact } from '../../contracts/artifacts/table.js';
import type { WorkbookArtifact } from '../../contracts/artifacts/workbook.js';
import { fileRefFromLocalScan } from '../../contracts/artifacts/file-ref.js';
import {
  buildTableArtifact,
  DEFAULT_TABLE_ROW_LIMIT,
  MAX_WORKBOOK_SHEETS,
} from './profile.js';

export interface ReadSheetOptions {
  path: string;
  sheetName?: string;
  rowLimit?: number;
}

export interface ReadWorkbookResult {
  workbook: WorkbookArtifact;
  tables: Record<string, TableArtifact>;
}

function fileRefForPath(path: string): FileRef {
  const name = basename(path);
  return fileRefFromLocalScan({
    filePath: path,
    fileName: name,
    extension: extname(name),
  });
}

import { parseCsvMatrix } from './csv-parse.js';
function sheetToMatrix(sheet: XLSX.WorkSheet): { headers: string[]; matrix: unknown[][] } {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: null }) as unknown[][];
  if (rows.length === 0) return { headers: [], matrix: [] };
  const headers = (rows[0] ?? []).map((cell, index) => String(cell ?? `column_${index + 1}`));
  const matrix = rows.slice(1);
  return { headers, matrix };
}

function sheetVisibility(hidden: number | undefined): 'visible' | 'hidden' | 'veryHidden' {
  if (hidden === 1) return 'hidden';
  if (hidden === 2) return 'veryHidden';
  return 'visible';
}

export function readWorkbookFromPath(path: string, options: { rowLimit?: number } = {}): ReadWorkbookResult {
  const rowLimit = options.rowLimit ?? DEFAULT_TABLE_ROW_LIMIT;
  const ext = extname(path).toLowerCase();
  const workbookId = `wb_${createHash('sha256').update(readFileSync(path)).digest('hex').slice(0, 16)}`;
  const file = fileRefForPath(path);

  if (ext === '.csv') {
    const { headers, matrix } = parseCsvMatrix(readFileSync(path, 'utf8'));
    const sheetName = basename(path, ext);
    const tableId = `tbl_${createHash('sha256').update(`${workbookId}:${sheetName}`).digest('hex').slice(0, 16)}`;
    const table = buildTableArtifact({
      id: tableId,
      name: sheetName,
      headers,
      matrix,
      rowLimit,
      source: { filePath: path, workbookSheet: sheetName },
    });
    const workbook: WorkbookArtifact = {
      id: workbookId,
      kind: 'workbook',
      file,
      sheets: [{
        name: sheetName,
        index: 0,
        visibility: 'visible',
        imageCount: 0,
        formulaCount: 0,
        chartCount: 0,
        tables: [{ id: tableId, artifactId: tableId }],
      }],
      namedRanges: [],
    };
    return { workbook, tables: { [tableId]: table } };
  }

  const xlsx = XLSX.read(readFileSync(path), { type: 'buffer', cellDates: true });
  const sheetNames = xlsx.SheetNames.slice(0, MAX_WORKBOOK_SHEETS);
  const tables: Record<string, TableArtifact> = {};
  const sheets: WorkbookArtifact['sheets'] = [];

  for (const [index, name] of sheetNames.entries()) {
    const sheet = xlsx.Sheets[name];
    if (!sheet) continue;
    const { headers, matrix } = sheetToMatrix(sheet);
    const tableId = `tbl_${createHash('sha256').update(`${workbookId}:${name}`).digest('hex').slice(0, 16)}`;
    const table = buildTableArtifact({
      id: tableId,
      name,
      headers,
      matrix,
      rowLimit,
      source: { filePath: path, workbookSheet: name },
    });
    tables[tableId] = table;
    const range = sheet['!ref'];
    sheets.push({
      name,
      index,
      visibility: sheetVisibility(xlsx.Workbook?.Sheets?.[index]?.Hidden),
      imageCount: 0,
      chartCount: 0,
      tables: [{ id: tableId, artifactId: tableId, range }],
      formulaCount: 0,
    });
  }

  const workbook: WorkbookArtifact = {
    id: workbookId,
    kind: 'workbook',
    file,
    sheets,
    namedRanges: (xlsx.Workbook?.Names ?? []).map((entry) => ({
      name: String((entry as { Name?: string }).Name ?? ''),
      ref: String((entry as { Ref?: string }).Ref ?? ''),
    })).filter((entry) => entry.name),
  };
  return { workbook, tables };
}

export function readSheetFromPath(options: ReadSheetOptions): TableArtifact {
  const { workbook, tables } = readWorkbookFromPath(options.path, { rowLimit: options.rowLimit });
  if (options.sheetName) {
    const sheet = workbook.sheets.find((entry) => entry.name === options.sheetName);
    const tableId = sheet?.tables[0]?.artifactId;
    if (tableId && tables[tableId]) return tables[tableId]!;
    throw new Error('sheet_not_found');
  }
  const firstTableId = workbook.sheets[0]?.tables[0]?.artifactId;
  if (!firstTableId || !tables[firstTableId]) {
    throw new Error('sheet_not_found');
  }
  return tables[firstTableId]!;
}
