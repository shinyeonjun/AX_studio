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

/** Convert only JSON-incompatible driver scalars; never coerce provider text. */
export function prepareRdbRows(rows: RdbRow[]): RdbRow[] {
  assertSafeRdbScalars(rows);
  return rows.map(row => Object.fromEntries(Object.entries(row).map(([key, value]) => [key,
    typeof value === 'bigint' ? String(value)
      : value instanceof Date ? value.toISOString() : value,
  ])));
}
