export function assertCsvShape(text: string, maxRows = 100_000, maxColumns = 1_024): void {
  let rows = 1;
  let columns = 1;
  let inQuotes = false;
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    const next = text[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') index += 1;
      else if (char === '"') inQuotes = false;
      continue;
    }
    if (char === '"') {
      inQuotes = true;
    } else if (char === ',') {
      columns += 1;
      if (columns > maxColumns) throw new Error('workbook_sheet_too_wide');
    } else if (char === '\n') {
      rows += 1;
      columns = 1;
      if (rows > maxRows) throw new Error('workbook_sheet_too_large');
    }
  }
}

export function parseCsvMatrix(text: string): { headers: string[]; matrix: unknown[][] } {
  if (text.charCodeAt(0) === 0xFEFF) text = text.slice(1);

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let rowHadDelimiter = false;
  let rowHadQuotedField = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    const next = text[index + 1];
    if (inQuotes) {
      if (char === '"' && next === '"') {
        field += '"';
        index += 1;
      } else if (char === '"') {
        inQuotes = false;
      } else {
        field += char;
      }
      continue;
    }
    if (char === '"' && field.length === 0) {
      inQuotes = true;
      rowHadQuotedField = true;
      continue;
    }
    if (char === ',') {
      row.push(field);
      field = '';
      rowHadDelimiter = true;
      continue;
    }
    if (char === '\n') {
      row.push(field);
      field = '';
      if (rowHadDelimiter || rowHadQuotedField || row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      rowHadDelimiter = false;
      rowHadQuotedField = false;
      continue;
    }
    if (char === '\r') continue;
    field += char;
  }
  row.push(field);
  if (rowHadDelimiter || rowHadQuotedField || row.some((cell) => cell.length > 0)) rows.push(row);

  if (rows.length === 0) return { headers: [], matrix: [] };
  const headers = rows[0]!.map((cell) => cell.trim());
  const matrix = rows.slice(1).map((cells) => headers.map((_, columnIndex) => {
    const value = cells[columnIndex] ?? '';
    return value.trim();
  }));
  return { headers, matrix };
}
