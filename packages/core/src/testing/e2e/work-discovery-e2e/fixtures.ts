import * as XLSX from 'xlsx';

export function writeSalesXlsx(path: string, rows: Array<{ amount: number; actual: number; target: number }>): void {
  const sheet = XLSX.utils.json_to_sheet(rows);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Sales');
  XLSX.writeFile(workbook, path);
}
