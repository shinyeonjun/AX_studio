import { TextDecoder } from 'node:util';

// sql.js TEXT reads stop at NUL. Read persisted JSON as BLOB to validate the
// entire original value, including corrupt suffixes and invalid UTF-8.
export function decodeSqliteJsonText(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (!(value instanceof Uint8Array)) return undefined;
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(value); }
  catch { return undefined; }
}

export function rawSqliteJsonText(value: unknown) {
  const text = decodeSqliteJsonText(value);
  return text === undefined && value instanceof Uint8Array
    ? { bytesHex: Buffer.from(value).toString('hex') } : text ?? null;
}
