import type { ReadSheetOptions } from './contracts.js';
import { readWorkbookFromPath } from './workbook.js';

export async function readSheetFromPath(options: ReadSheetOptions) {
  const { workbook, tables } = await readWorkbookFromPath(options.path, { rowLimit: options.rowLimit });
  if (options.sheetName) {
    const sheet = findSheet(workbook.sheets, options.sheetName);
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

/** Spacing and capitals aside ("1월 매출" for "1월매출"); the exact name wins, and an ambiguous
 * loose match finds nothing rather than guessing. */
export function findSheet<T extends { name: string }>(sheets: readonly T[], wanted: string): T | undefined {
  const exact = sheets.find((entry) => entry.name === wanted);
  if (exact) return exact;
  const key = (name: string) => name.normalize('NFC').replace(/\s+/gu, '').toLowerCase();
  const loose = sheets.filter((entry) => key(entry.name) === key(wanted));
  return loose.length === 1 ? loose[0] : undefined;
}
