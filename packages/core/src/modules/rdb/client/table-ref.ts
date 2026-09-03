import type { RdbTableRef } from './types.js';

const IDENTIFIER_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

export function parseRdbTableRef(value: unknown): RdbTableRef | null {
  if (typeof value !== 'string') return null;
  const parts = value.trim().split('.');
  if (parts.length !== 1 && parts.length !== 2) return null;
  if (parts.some((part) => !IDENTIFIER_RE.test(part))) return null;
  return parts.length === 2
    ? { schema: parts[0], table: parts[1]! }
    : { table: parts[0]! };
}

export function formatRdbTableRef(ref: RdbTableRef): string {
  return ref.schema ? `${ref.schema}.${ref.table}` : ref.table;
}

function quoteIdentifier(identifier: string, quote: '"' | '`'): string {
  if (!IDENTIFIER_RE.test(identifier)) throw new Error('invalid_table_name');
  return `${quote}${identifier}${quote}`;
}

export function quoteTableRef(ref: RdbTableRef, quote: '"' | '`'): string {
  return ref.schema
    ? `${quoteIdentifier(ref.schema, quote)}.${quoteIdentifier(ref.table, quote)}`
    : quoteIdentifier(ref.table, quote);
}
