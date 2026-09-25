import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { extname } from 'node:path';
import * as XLSX from 'xlsx';
import type { FileRef } from '../../../contracts/artifacts/file-ref.js';
import type { TableArtifact } from '../../../contracts/artifacts/table.js';
import type { WorkbookArtifact } from '../../../contracts/artifacts/workbook.js';
import {
  buildTableArtifact,
  DEFAULT_TABLE_ROW_LIMIT,
  MAX_TABLE_ROW_LIMIT,
  MAX_WORKBOOK_SHEETS,
} from '../profile.js';
import type { ReadWorkbookResult } from './contracts.js';
import {
  assertWorkbookByteLength,
  assertWorkbookSize,
  assertXlsxArchiveSafety,
  looksLikeZipArchive,
  sheetVisibility,
} from './shared.js';

function sheetToMatrix(
  sheet: XLSX.WorkSheet,
  requestedRowLimit = DEFAULT_TABLE_ROW_LIMIT,
): { headers: string[]; matrix: unknown[][] } {
  const rangeText = typeof sheet['!ref'] === 'string' ? sheet['!ref'] : undefined;
  if (!rangeText) return { headers: [], matrix: [] };
  const range = XLSX.utils.decode_range(rangeText);
  const rowCount = range.e.r - range.s.r + 1;
  const columnCount = range.e.c - range.s.c + 1;
  if (columnCount > 1_024 || rowCount * columnCount > 2_000_000) {
    throw new Error('workbook_sheet_too_large');
  }
  const rowLimit = Number.isFinite(requestedRowLimit)
    ? Math.min(MAX_TABLE_ROW_LIMIT, Math.max(1, Math.floor(requestedRowLimit)))
    : DEFAULT_TABLE_ROW_LIMIT;
  const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    defval: null,
    range: {
      s: range.s,
      e: { r: Math.min(range.e.r, range.s.r + rowLimit), c: range.e.c },
    },
  }) as unknown[][];
  if (rows.length === 0) return { headers: [], matrix: [] };
  const headers = (rows[0] ?? []).map((cell, index) => String(cell ?? `column_${index + 1}`));
  return { headers, matrix: rows.slice(1) };
}

export function readXlsxWorkbook(options: {
  path: string;
  rowLimit: number;
  workbookId: string;
  file: FileRef;
  data?: Uint8Array;
}): ReadWorkbookResult {
  const { path, rowLimit, workbookId, file, data } = options;
  if (!data) assertWorkbookSize(path);
  const workbookData = data ?? readFileSync(path);
  assertWorkbookByteLength(workbookData.byteLength);
  if (extname(path).toLowerCase() === '.xlsx' || looksLikeZipArchive(workbookData)) {
    assertXlsxArchiveSafety(workbookData);
  }
  const xlsx = XLSX.read(workbookData, {
    type: 'buffer',
    cellDates: true,
    cellFormula: false,
    cellHTML: false,
    cellStyles: false,
    cellNF: false,
    WTF: false,
  });
  const sheetNames = xlsx.SheetNames.slice(0, MAX_WORKBOOK_SHEETS);
  const tables: Record<string, TableArtifact> = {};
  const sheets: WorkbookArtifact['sheets'] = [];

  for (const [index, name] of sheetNames.entries()) {
    const sheet = xlsx.Sheets[name];
    if (!sheet) continue;
    const { headers, matrix } = sheetToMatrix(sheet, rowLimit);
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
