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

const pad = (value: number, width = 2) => String(value).padStart(width, '0');

/**
 * A spreadsheet date as the person typed it. Readers build dates at local midnight, so local
 * parts are the calendar date; JSON (UTC) would print the previous day east of Greenwich.
 */
function localDateText(date: Date): string | null {
  if (Number.isNaN(date.getTime())) return null;
  const day = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  if (date.getHours() === 0 && date.getMinutes() === 0 && date.getSeconds() === 0 && date.getMilliseconds() === 0) return day;
  return `${day} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/** Digits beyond this cannot round-trip through a JS number; such values are identifiers, kept as text. */
const MAX_EXACT_DIGITS = 15;

/**
 * The number a text cell holds, or undefined when it is not plain numeric text or is an
 * identifier that only looks numeric: a leading zero ("01234", phone numbers) or more digits
 * than a number keeps exactly (account and card numbers).
 */
export function numericText(text: string): number | undefined {
  const plain = text.replace(/,/g, '');
  if (!/^-?\d+(\.\d+)?$/.test(plain)) return undefined;
  const integerPart = plain.replace(/^-/, '').split('.')[0]!;
  if (integerPart.length > 1 && integerPart.startsWith('0')) return undefined;
  if (plain.replace(/[-.]/g, '').length > MAX_EXACT_DIGITS) return undefined;
  const value = Number(plain);
  return Number.isFinite(value) ? value : undefined;
}

export function inferColumnType(values: unknown[], options: { numericStrings?: boolean } = {}): TableColumnType {
  const nonNull = values
    .map((value) => value instanceof Date ? localDateText(value) : value)
    .filter((value) => value != null && `${value}`.trim() !== '');
  if (nonNull.length === 0) return 'unknown';
  if (nonNull.every((value) => typeof value === 'boolean')) return 'boolean';
  if (nonNull.every((value) => typeof value === 'number' && Number.isInteger(value))) return 'integer';
  if (nonNull.every((value) => typeof value === 'number')) return 'number';
  const asString = nonNull.map((value) => String(value));
  if (asString.every((value) => /^\d{4}-\d{2}-\d{2}$/.test(value))) return 'date';
  if (asString.every((value) => /^\d{4}-\d{2}-\d{2}[T ]/.test(value))) return 'datetime';
  if (asString.every((value) => value.endsWith('%'))) return 'percentage';
  if (options.numericStrings !== false
    && asString.every((value) => numericText(value.replace(/[₩$€]/g, '')) !== undefined)) return 'number';
  return 'string';
}

export function normalizeScalar(value: unknown): ScalarValue {
  if (value == null || value === '') return null;
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return localDateText(value);
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
  return numericText(text) ?? text;
}

/** Keep source strings untrimmed and uncoerced; serialize only non-scalar values. */
function rawScalar(value: unknown): ScalarValue {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return localDateText(value);
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value) ?? '';
    } catch {
      return Object.prototype.toString.call(value);
    }
  }
  return String(value);
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
  /** Full source extent before a connector caps its matrix. */
  sourceRowCount?: number;
  /** Opt in at source intake; calculated values keep their legacy semantics. */
  preserveRawValues?: boolean;
  /** Preserve provider scalar types/strings rather than trim or infer numbers. */
  scalarPolicy?: 'legacy' | 'preserve';
  rowProvenance?: {
    firstRow: number;
    firstColumn: number;
    rowKeys: string[];
  };
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
    type: inferColumnType(columnValues[index] ?? [], { numericStrings: params.scalarPolicy !== 'preserve' }),
    nullable: true,
    inferred: true,
    ...(params.rowProvenance ? { sourceColumn: params.rowProvenance.firstColumn + index } : {}),
  }));
  const limited = params.matrix.length > rowLimit ? params.matrix.slice(0, rowLimit) : params.matrix;
  const sourceRowCount = params.sourceRowCount ?? params.matrix.length;
  if (!Number.isInteger(sourceRowCount) || sourceRowCount < params.matrix.length) {
    throw new Error('invalid_table_source_row_count');
  }
  const provenance = params.rowProvenance;
  if (provenance && (
    !Number.isInteger(provenance.firstRow) || provenance.firstRow < 1
    || !Number.isInteger(provenance.firstColumn) || provenance.firstColumn < 1
    || provenance.rowKeys.length !== params.matrix.length
    || provenance.rowKeys.some((key) => typeof key !== 'string' || !key)
  )) {
    throw new Error('invalid_table_row_provenance');
  }
  const truncated = sourceRowCount > limited.length;
  const rows = limited.map((row, index) => ({
    index,
    values: Object.fromEntries(headers.map((name, columnIndex) => [name,
      params.scalarPolicy === 'preserve' ? rawScalar(row[columnIndex]) : normalizeScalar(row[columnIndex])])),
    ...(params.preserveRawValues ? {
      rawValues: Object.fromEntries(headers.map((name, columnIndex) => [name, rawScalar(row[columnIndex])])),
    } : {}),
    ...(params.rowProvenance ? {
      key: params.rowProvenance.rowKeys[index],
      sourceRow: params.rowProvenance.firstRow + index,
    } : {}),
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
  options: {
    id: string;
    name?: string;
    source?: TableArtifact['source'];
    rowLimit?: number;
    preserveRawValues?: boolean;
    scalarPolicy?: 'legacy' | 'preserve';
  },
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
      preserveRawValues: options.preserveRawValues,
      scalarPolicy: options.scalarPolicy,
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
