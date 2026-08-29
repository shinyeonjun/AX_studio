import type { ScalarValue, TableArtifact, TableColumn, TableColumnType, TableProfile } from './table.js';

export const DEFAULT_TABLE_ROW_LIMIT = 5_000;
export const MODEL_PREVIEW_ROW_LIMIT = 50;
export const MAX_WORKBOOK_SHEETS = 20;

function uniqueHeaders(headers: string[]): string[] {
  const normalized = headers.map((header, index) => header?.trim() || `column_${index + 1}`);
  const reserved = new Set(normalized);
  const used = new Set<string>();

  return normalized.map((header) => {
    if (!used.has(header)) {
      used.add(header);
      return header;
    }

    let suffix = 2;
    while (reserved.has(`${header}_${suffix}`) || used.has(`${header}_${suffix}`)) suffix += 1;
    const unique = `${header}_${suffix}`;
    used.add(unique);
    return unique;
  });
}

export function inferColumnType(values: unknown[]): TableColumnType {
  const nonNull = values.filter((value) => value != null && `${value}`.trim() !== '');
  if (nonNull.length === 0) return 'unknown';
  if (nonNull.every((value) => typeof value === 'boolean')) return 'boolean';
  if (nonNull.every((value) => typeof value === 'number' && Number.isInteger(value))) return 'integer';
  if (nonNull.every((value) => typeof value === 'number')) return 'number';
  const asString = nonNull.map((value) => String(value));
  if (asString.every((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))) return 'date';
  if (asString.every((value) => /^\d{4}-\d{2}-\d{2}[T ]/.test(value))) return 'datetime';
  if (asString.every((value) => value.endsWith('%'))) return 'percentage';
  if (asString.every((value) => /^-?\d[\d,]*(\.\d+)?$/.test(value.replace(/[₩$€,]/g, '')))) return 'number';
  return 'string';
}

export function normalizeScalar(value: unknown): ScalarValue {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  const text = String(value).trim();
  if (!text) return null;
  const numeric = Number(text.replace(/,/g, ''));
  if (!Number.isNaN(numeric) && /^-?\d[\d,]*(\.\d+)?$/.test(text.replace(/,/g, ''))) return numeric;
  return text;
}

function extrema(values: NonNullable<ScalarValue>[]): { min?: ScalarValue; max?: ScalarValue } {
  if (values.length === 0) return {};
  const type = typeof values[0];
  if (!values.every((value) => typeof value === type)) return {};

  let min = values[0]!;
  let max = values[0]!;
  for (const value of values.slice(1)) {
    if (value < min) min = value;
    if (value > max) max = value;
  }
  return { min, max };
}

export function profileTable(columns: TableColumn[], rows: TableArtifact['rows']): TableProfile {
  const columnProfiles: TableProfile['columns'] = {};
  for (const column of columns) {
    const values = rows.map((row) => row.values[column.name]);
    const nonNull = values.filter((value) => value != null);
    const numeric = nonNull.filter((value): value is number => typeof value === 'number');
    const { min, max } = extrema(nonNull);
    columnProfiles[column.name] = {
      nullCount: values.length - nonNull.length,
      distinctCount: new Set(nonNull.map((value) => JSON.stringify(value))).size,
      min,
      max,
      mean: numeric.length > 0 ? numeric.reduce((sum, value) => sum + value, 0) / numeric.length : undefined,
      sampleValues: nonNull.slice(0, 12),
    };
  }
  return {
    rowCount: rows.length,
    columnCount: columns.length,
    columns: columnProfiles,
  };
}

export function buildTableArtifact(params: {
  id: string;
  name?: string;
  headers: string[];
  matrix: unknown[][];
  rowLimit?: number;
  source?: TableArtifact['source'];
}): TableArtifact {
  const rowLimit = params.rowLimit ?? DEFAULT_TABLE_ROW_LIMIT;
  const headers = uniqueHeaders(params.headers);
  const columnValues = headers.map((_, columnIndex) =>
    params.matrix.map((row) => row[columnIndex]),
  );
  const columns: TableColumn[] = headers.map((name, index) => ({
    name,
    type: inferColumnType(columnValues[index] ?? []),
    nullable: true,
    inferred: true,
  }));
  const truncated = params.matrix.length > rowLimit;
  const limited = truncated ? params.matrix.slice(0, rowLimit) : params.matrix;
  const rows = limited.map((row, index) => ({
    index,
    values: Object.fromEntries(headers.map((name, columnIndex) => [name, normalizeScalar(row[columnIndex])])),
  }));
  const artifact: TableArtifact = {
    id: params.id,
    kind: 'table',
    name: params.name,
    columns,
    rows,
    truncated,
    source: params.source,
  };
  artifact.profile = profileTable(columns, rows);
  return artifact;
}
