import type { ReadSheetOptions } from './contracts.js';
import { readWorkbookFromPath } from './workbook.js';

export function readSheetFromPath(options: ReadSheetOptions) {
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
