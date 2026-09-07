import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as XLSX from 'xlsx';
import type { FileRef } from '../../../contracts/artifacts/file-ref.js';
import type { TableArtifact } from '../../../contracts/artifacts/table.js';
import type { WorkbookArtifact } from '../../../contracts/artifacts/workbook.js';
import {
  buildTableArtifact,
  MAX_WORKBOOK_SHEETS,
} from '../profile.js';
import type { ReadWorkbookResult } from './contracts.js';
import { sheetToMatrix, sheetVisibility } from './shared.js';

export function readXlsxWorkbook(options: {
  path: string;
  rowLimit: number;
  workbookId: string;
  file: FileRef;
}): ReadWorkbookResult {
  const { path, rowLimit, workbookId, file } = options;
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
