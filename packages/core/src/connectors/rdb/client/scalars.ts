import type { RdbRow } from './types.js';

/** No scalar value is included in a failure: it may be sensitive source data. */
export class RdbScalarReadError extends Error {
  readonly errorCode = 'unsafe_precision';

  constructor(readonly reason: 'rdb_unsafe_integer' | 'rdb_non_finite_number') {
    super(reason);
    this.name = 'RdbScalarReadError';
  }
}

/**
 * Interim DB-specific safety gate, before the legacy TableArtifact coercion.
 * Exact decimal arithmetic is not supported here. Numeric-looking integral
 * text beyond the safe range is conservatively refused too: without physical
 * type metadata it could be BIGINT/NUMERIC or a text identifier.
 */
export function assertSafeRdbScalars(rows: RdbRow[]): void {
  for (const row of rows) {
    for (const value of Object.values(row)) {
      if (typeof value === 'bigint') {
        if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
          throw new RdbScalarReadError('rdb_unsafe_integer');
        }
      } else if (typeof value === 'number') {
        if (!Number.isFinite(value)) throw new RdbScalarReadError('rdb_non_finite_number');
        if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
          throw new RdbScalarReadError('rdb_unsafe_integer');
        }
      } else if (typeof value === 'string') {
        const normalized = value.trim().replace(/,/g, '');
        if (/^[+-]?(?:\d+\.?\d*|\.\d+)$/.test(normalized)) {
          const numeric = Number(normalized);
          if (!Number.isFinite(numeric) || (Number.isInteger(numeric) && !Number.isSafeInteger(numeric))) {
            throw new RdbScalarReadError('rdb_unsafe_integer');
          }
        }
      }
    }
  }
}

/** Cumulative budget for one RDB page so a wide/large result cannot exhaust memory. */
export const RDB_PAGE_MAX_BYTES = 32 * 1024 * 1024;
/** A single cell larger than this is truncated with a visible marker. */
export const RDB_CELL_MAX_BYTES = 1024 * 1024;
export const RDB_TRUNCATED_CELL_MARKER = '…[truncated]';

function truncateUtf8(value: string, maxBytes: number): string {
  const encoded = Buffer.from(value, 'utf8');
  if (encoded.length <= maxBytes) return value;
  // Decoding a cut buffer can leave a partial code point; drop the replacement char.
  return `${encoded.subarray(0, maxBytes).toString('utf8').replace(/\uFFFD$/u, '')}${RDB_TRUNCATED_CELL_MARKER}`;
}

function prepareCell(value: unknown): { value: unknown; bytes: number } {
  if (typeof value === 'bigint') {
    const text = String(value);
    return { value: text, bytes: text.length };
  }
  if (value instanceof Date) return { value: value.toISOString(), bytes: 24 };
  if (typeof value === 'string') {
    const bytes = Buffer.byteLength(value, 'utf8');
    if (bytes <= RDB_CELL_MAX_BYTES) return { value, bytes };
    const truncated = truncateUtf8(value, RDB_CELL_MAX_BYTES);
    return { value: truncated, bytes: RDB_CELL_MAX_BYTES };
  }
  if (value instanceof Uint8Array) {
    if (value.byteLength <= RDB_CELL_MAX_BYTES) return { value, bytes: value.byteLength * 4 };
    const marker = `[binary ${value.byteLength} bytes]${RDB_TRUNCATED_CELL_MARKER}`;
    return { value: marker, bytes: marker.length };
  }
  return { value, bytes: 16 };
}

/**
 * Convert only JSON-incompatible driver scalars; never coerce provider text.
 * Oversized cells are truncated with a marker, and rows stop once the page
 * byte budget is spent (at least one row is always kept). Callers detect the
 * budget stop by comparing the returned length with the input length.
 */
export function prepareRdbRows(rows: RdbRow[], maxBytes = RDB_PAGE_MAX_BYTES): RdbRow[] {
  assertSafeRdbScalars(rows);
  const prepared: RdbRow[] = [];
  let total = 0;
  for (const row of rows) {
    let rowBytes = 0;
    const entries = Object.entries(row).map(([key, value]) => {
      const cell = prepareCell(value);
      rowBytes += cell.bytes + key.length;
      return [key, cell.value] as const;
    });
    if (prepared.length > 0 && total + rowBytes > maxBytes) break;
    total += rowBytes;
    prepared.push(Object.fromEntries(entries));
  }
  return prepared;
}
