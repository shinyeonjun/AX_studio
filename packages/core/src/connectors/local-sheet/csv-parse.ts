export type CsvDelimiter = ',' | '\t' | ';';

const CSV_DELIMITERS: readonly CsvDelimiter[] = [',', '\t', ';'];

/**
 * Decode CSV bytes. A UTF-8/UTF-16 BOM wins; otherwise strict UTF-8 is tried
 * and Korean legacy exports (CP949/EUC-KR, common from Excel) are the fallback.
 */
export function decodeCsvBytes(data: Uint8Array): string {
  if (data[0] === 0xef && data[1] === 0xbb && data[2] === 0xbf) {
    return new TextDecoder('utf-8').decode(data.subarray(3));
  }
  if (data[0] === 0xff && data[1] === 0xfe) return new TextDecoder('utf-16le').decode(data.subarray(2));
  if (data[0] === 0xfe && data[1] === 0xff) return new TextDecoder('utf-16be').decode(data.subarray(2));
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(data);
  } catch {
    return new TextDecoder('euc-kr').decode(data);
  }
}

/** Pick the delimiter that splits the first lines most consistently (`.tsv` is always tab). */
export function sniffCsvDelimiter(text: string, extension = '.csv'): CsvDelimiter {
  if (extension.toLowerCase() === '.tsv') return '\t';
  const lines: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let index = 0; index < text.length && lines.length < 20 && index < 65_536; index += 1) {
    const char = text[index]!;
    if (char === '"') inQuotes = !inQuotes;
    if (!inQuotes && (char === '\n' || char === '\r')) {
      if (current.trim()) lines.push(current);
      current = '';
      continue;
    }
    if (!inQuotes) current += char;
  }
  if (current.trim() && lines.length < 20) lines.push(current);
  let best: CsvDelimiter = ',';
  let bestScore = 0;
  for (const delimiter of CSV_DELIMITERS) {
    const counts = lines.map((line) => line.split(delimiter).length - 1);
    const first = counts[0] ?? 0;
    if (first === 0) continue;
    const score = counts.filter((count) => count === first).length * 1_000 + first;
    if (score > bestScore) {
      best = delimiter;
      bestScore = score;
    }
  }
  return best;
}

export function assertCsvShape(text: string, maxRows = 100_000, maxColumns = 1_024, delimiter: CsvDelimiter = ','): void {
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
    } else if (char === delimiter) {
      columns += 1;
      if (columns > maxColumns) throw new Error('workbook_sheet_too_wide');
    } else if (char === '\n' || (char === '\r' && next !== '\n')) {
      rows += 1;
      columns = 1;
      if (rows > maxRows) throw new Error('workbook_sheet_too_large');
    }
  }
}

export function parseCsvMatrix(text: string, delimiter: CsvDelimiter = ','): { headers: string[]; matrix: unknown[][] } {
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
    if (char === delimiter) {
      row.push(field);
      field = '';
      rowHadDelimiter = true;
      continue;
    }
    if (char === '\r' && next === '\n') continue;
    if (char === '\n' || char === '\r') {
      row.push(field);
      field = '';
      if (rowHadDelimiter || rowHadQuotedField || row.some((cell) => cell.length > 0)) rows.push(row);
      row = [];
      rowHadDelimiter = false;
      rowHadQuotedField = false;
      continue;
    }
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
