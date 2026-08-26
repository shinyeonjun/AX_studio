export function parseCsvMatrix(text: string): { headers: string[]; matrix: unknown[][] } {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let rowHadDelimiter = false;

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
      if (rowHadDelimiter || row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      rowHadDelimiter = false;
      continue;
    }
    if (char === '\r') continue;
    field += char;
  }
  row.push(field);
  if (rowHadDelimiter || row.some((cell) => cell.length > 0)) rows.push(row);

  if (rows.length === 0) return { headers: [], matrix: [] };
  const headers = rows[0]!.map((cell) => cell.trim());
  const matrix = rows.slice(1).map((cells) => headers.map((_, columnIndex) => {
    const value = cells[columnIndex] ?? '';
    return value.trim();
  }));
  return { headers, matrix };
}
