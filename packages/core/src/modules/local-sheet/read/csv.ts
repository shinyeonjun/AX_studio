import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { basename, extname } from 'node:path';
import type { FileRef } from '../../../contracts/artifacts/file-ref.js';
import type { TableArtifact } from '../../../contracts/artifacts/table.js';
import type { WorkbookArtifact } from '../../../contracts/artifacts/workbook.js';
import { parseCsvMatrix } from '../csv-parse.js';
import {
  buildTableArtifact,
  DEFAULT_TABLE_ROW_LIMIT,
} from '../profile.js';
import type { ReadWorkbookResult } from './contracts.js';

export function readCsvWorkbook(options: {
  path: string;
  rowLimit: number;
  workbookId: string;
  file: FileRef;
}): ReadWorkbookResult {
  const { path, rowLimit, workbookId, file } = options;
  const ext = extname(path).toLowerCase();
  const { headers, matrix } = parseCsvMatrix(readFileSync(path, 'utf8'));
  const sheetName = basename(path, ext);
  const tableId = `tbl_${createHash('sha256').update(`${workbookId}:${sheetName}`).digest('hex').slice(0, 16)}`;
  const table = buildTableArtifact({
    id: tableId,
    name: sheetName,
    headers,
    matrix,
    rowLimit: rowLimit ?? DEFAULT_TABLE_ROW_LIMIT,
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
