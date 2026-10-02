import { createHash } from 'node:crypto';
import type { JsonValue, SourceScope } from './types.js';

export class ReadControlError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'ReadControlError';
  }
}

/** JSON-only, canonical and non-coercing: rejects mutable/prototype/cyclic payloads. */
export function canonicalJson(value: unknown, seen = new Set<object>()): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (typeof value !== 'object' || value === null || seen.has(value)) throw new ReadControlError('invalid_json_value');
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) {
    throw new ReadControlError('invalid_json_value');
  }
  if (Object.getOwnPropertySymbols(value).length > 0 || Object.values(Object.getOwnPropertyDescriptors(value))
    .some((descriptor) => descriptor.get || descriptor.set)) throw new ReadControlError('invalid_json_value');
  if (Array.isArray(value) && Array.from({ length: value.length }, (_, index) => index)
    .some((index) => !Object.hasOwn(value, index))) throw new ReadControlError('invalid_json_value');
  seen.add(value);
  try {
    if (Array.isArray(value)) return `[${value.map((entry) => canonicalJson(entry, seen)).join(',')}]`;
    return `{${Object.keys(value).sort().map((key) =>
      `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key], seen)}`).join(',')}}`;
  } finally {
    seen.delete(value);
  }
}

export function immutableCopy<T>(value: T): T {
  const copy = JSON.parse(canonicalJson(value)) as T;
  const freeze = (current: unknown): void => {
    if (!current || typeof current !== 'object') return;
    Object.values(current).forEach(freeze);
    Object.freeze(current);
  };
  freeze(copy);
  return copy;
}

export function valueDigest(value: JsonValue | unknown): string {
  return `sha256:${createHash('sha256').update(canonicalJson(value), 'utf8').digest('hex')}`;
}

export function sameSource(left: SourceScope, right: SourceScope): boolean {
  return left.connector === right.connector && left.sourceId === right.sourceId && left.connectionId === right.connectionId;
}

/** Awaiting abort promptly never publishes a late callback result. */
export async function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) {
    // The callback/pool may have synchronously aborted while creating this
    // promise. Still own its eventual rejection even though we cannot await it.
    void promise.catch(() => undefined);
    signal.throwIfAborted();
  }
  return new Promise<T>((resolve, reject) => {
    const abort = () => { cleanup(); reject(signal.reason ?? new ReadControlError('cancelled')); };
    const cleanup = () => signal.removeEventListener('abort', abort);
    signal.addEventListener('abort', abort, { once: true });
    promise.then((value) => {
      cleanup();
      if (signal.aborted) reject(signal.reason ?? new ReadControlError('cancelled'));
      else resolve(value);
    }, (error: unknown) => { cleanup(); reject(error); });
    if (signal.aborted) abort();
  });
}
