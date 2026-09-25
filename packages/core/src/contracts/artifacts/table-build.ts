import {
  completeArtifactCompleteness,
  partialArtifactCompleteness,
} from './completeness.js';
import type { ScalarValue, TableArtifact, TableColumn, TableColumnType, TableProfile } from './table.js';

export const DEFAULT_TABLE_ROW_LIMIT = 5_000;
export const MAX_TABLE_ROW_LIMIT = 50_000;
export const MODEL_PREVIEW_ROW_LIMIT = 50;
export const MAX_WORKBOOK_SHEETS = 20;
/** Bound parser work before SheetJS expands an input workbook in memory. */
export const MAX_WORKBOOK_BYTES = 25 * 1024 * 1024;

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
  let text: string;
  if (typeof value === 'object') {
    try {
      text = JSON.stringify(value) ?? '';
    } catch {
      text = Object.prototype.toString.call(value);
    }
  } else {
    text = String(value);
  }
  text = text.trim();
  if (!text) return null;
  const numeric = Number(text.replace(/,/g, ''));
  if (!Number.isNaN(numeric) && /^-?\d[\d,]*(\.\d+)?$/.test(text.replace(/,/g, ''))) return numeric;
  return text;
}

const NON_FINITE_PROFILE_KEY = Symbol('non-finite-profile-value');

export function profileTable(columns: TableColumn[], rows: TableArtifact['rows']): TableProfile {
  const columnProfiles: TableProfile['columns'] = {};
  for (const column of columns) {
    let nullCount = 0;
    let numericSum = 0;
    let numericCount = 0;
    let firstType: string | undefined;
    let homogeneous = true;
    let min: ScalarValue | undefined;
    let max: ScalarValue | undefined;
    let hasValue = false;
    const distinctValues = new Set<ScalarValue | symbol>();
    const sampleValues: ScalarValue[] = [];

    for (const row of rows) {
      const value = row.values[column.name];
      if (value == null) {
        nullCount += 1;
        continue;
      }

      // JSON serializes all non-finite numbers as null; preserve that distinct-count behavior.
      distinctValues.add(typeof value === 'number' && !Number.isFinite(value) ? NON_FINITE_PROFILE_KEY : value);
      if (sampleValues.length < 12) sampleValues.push(value);

      const type = typeof value;
      if (!hasValue) {
        firstType = type;
        min = value;
        max = value;
        hasValue = true;
      } else if (type !== firstType) {
        homogeneous = false;
      } else if (homogeneous && typeof value === 'number' && typeof min === 'number' && typeof max === 'number') {
        if (value < min) min = value;
        if (value > max) max = value;
      } else if (homogeneous && typeof value === 'string' && typeof min === 'string' && typeof max === 'string') {
        if (value < min) min = value;
        if (value > max) max = value;
      } else if (homogeneous && typeof value === 'boolean' && typeof min === 'boolean' && typeof max === 'boolean') {
        if (value < min) min = value;
        if (value > max) max = value;
      }

      if (typeof value === 'number') {
        numericSum += value;
        numericCount += 1;
      }
    }

    columnProfiles[column.name] = {
      nullCount,
      distinctCount: distinctValues.size,
      min: homogeneous ? min : undefined,
      max: homogeneous ? max : undefined,
      mean: numericCount > 0 ? numericSum / numericCount : undefined,
      sampleValues,
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
  const configuredRowLimit = params.rowLimit ?? DEFAULT_TABLE_ROW_LIMIT;
  const rowLimit = Number.isFinite(configuredRowLimit)
    ? Math.min(MAX_TABLE_ROW_LIMIT, Math.max(1, Math.floor(configuredRowLimit)))
    : DEFAULT_TABLE_ROW_LIMIT;
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
    completeness: truncated
      ? partialArtifactCompleteness('row_limit', {
        observedCount: limited.length,
        limit: rowLimit,
        hasMore: true,
      })
      : completeArtifactCompleteness(limited.length),
    source: params.source,
  };
  artifact.profile = profileTable(columns, rows);
  return artifact;
}

/** Convert the common connector row shape at one shared contract seam. */
export function tableArtifactFromRows(
  value: unknown,
  options: { id: string; name?: string; source?: TableArtifact['source']; rowLimit?: number },
): TableArtifact | undefined {
  if (Array.isArray(value)) {
    const headerSet = new Set<string>();
    for (let rowIndex = 0; rowIndex < value.length; rowIndex += 1) {
      const row = value[rowIndex];
      if (!row || typeof row !== 'object' || Array.isArray(row)) return undefined;
      for (const header of Object.keys(row)) headerSet.add(header);
    }
    const headers = [...headerSet];
    return buildTableArtifact({
      id: options.id,
      name: options.name,
      headers,
      matrix: value.map((row) => headers.map((header) => (row as Record<string, unknown>)[header])),
      rowLimit: options.rowLimit,
      source: options.source,
    });
  }
  return undefined;
}

/** Convert a legacy worksheet matrix whose first row contains column names. */
export function tableArtifactFromMatrix(
  value: unknown,
  options: { id: string; name?: string; source?: TableArtifact['source']; rowLimit?: number },
): TableArtifact | undefined {
  if (!Array.isArray(value) || !value.every(Array.isArray)) return undefined;
  const [headerRow, ...matrix] = value as unknown[][];
  if (!headerRow) {
    return buildTableArtifact({
      id: options.id,
      name: options.name,
      headers: [],
      matrix: [],
      rowLimit: options.rowLimit,
      source: options.source,
    });
  }
  const headers = headerRow.map((header, index) =>
    header == null || String(header).trim() === '' ? `column_${index + 1}` : String(header),
  );
  return buildTableArtifact({
    id: options.id,
    name: options.name,
    headers,
    matrix,
    rowLimit: options.rowLimit,
    source: options.source,
  });
}
