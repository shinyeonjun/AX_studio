import { TableArtifactSchema } from '../../../contracts/artifacts/table.js';

function formatTableValue(value: unknown): string {
  if (value == null) return '';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function tableToText(table: unknown): string {
  const artifact = TableArtifactSchema.safeParse(table);
  if (artifact.success) {
    const headers = artifact.data.columns.map((column) => column.name);
    if (headers.length === 0) return '';
    return [
      headers.join('\t'),
      ...artifact.data.rows.map((row) =>
        headers.map((header) => formatTableValue(row.values[header])).join('\t'),
      ),
    ].join('\n');
  }

  if (!Array.isArray(table) || table.length === 0) return '';

  const first = table[0];
  if (Array.isArray(first)) {
    return (table as unknown[][])
      .map((row) => row.map((cell) => formatTableValue(cell)).join('\t'))
      .join('\n');
  }

  if (first && typeof first === 'object') {
    const rows = table as Record<string, unknown>[];
    const headers = Object.keys(rows[0] ?? {});
    const lines = [headers.join('\t')];
    for (const row of rows) {
      lines.push(headers.map((header) => formatTableValue(row[header])).join('\t'));
    }
    return lines.join('\n');
  }

  return table.map((row) => formatTableValue(row)).join('\n');
}

export function documentToText(value: unknown): string {
  if (!value || typeof value !== 'object') return '';
  const record = value as Record<string, unknown>;
  if (typeof record.text === 'string' && record.text.trim()) return record.text;
  const pages = Array.isArray(record.pages) ? record.pages : [];
  const pageText = pages
    .map((page) => {
      if (!page || typeof page !== 'object') return '';
      const text = (page as Record<string, unknown>).text;
      return typeof text === 'string' ? text : '';
    })
    .filter(Boolean)
    .join('\n\n');
  return pageText.trim();
}
