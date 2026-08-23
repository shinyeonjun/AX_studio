import type { ObservationValue } from '../observation/schema.js';
import type { ScalarValue } from '../../contracts/artifacts/table.js';

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.replace(/,/g, '').replace(/%/g, '').trim());
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function normalizeText(value: unknown): string {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

export function compareObservationValue(
  expected: ObservationValue,
  actual: ScalarValue | unknown,
): number {
  if (expected.kind === 'number') {
    const expectedNumber = expected.value;
    const actualNumber = toNumber(actual);
    if (actualNumber == null) return 0;
    if (expected.unit === '%' || expected.display?.includes('%')) {
      const delta = Math.abs(expectedNumber - actualNumber);
      if (delta <= 0.05) return 1;
      if (delta <= 0.5) return 0.98;
      return delta / Math.max(Math.abs(expectedNumber), 1) <= 0.01 ? 0.95 : 0;
    }
    if (expected.unit === '억' || expected.display?.includes('억')) {
      if (expectedNumber === actualNumber) return 1;
      const scale = Math.max(Math.abs(expectedNumber), Math.abs(actualNumber), 1);
      return Math.abs(expectedNumber - actualNumber) / scale <= 0.01 ? 0.95 : 0;
    }
    if (Number.isInteger(expectedNumber)) {
      return expectedNumber === actualNumber ? 1 : 0;
    }
    if (expectedNumber === actualNumber) return 1;
    const delta = Math.abs(expectedNumber - actualNumber);
    const scale = Math.max(Math.abs(expectedNumber), Math.abs(actualNumber), 1);
    return delta / scale <= 0.01 ? 0.95 : 0;
  }

  if (expected.kind === 'text') {
    return normalizeText(expected.value) === normalizeText(actual) ? 1 : 0;
  }

  if (expected.kind === 'date') {
    return normalizeText(expected.value) === normalizeText(actual) ? 1 : 0;
  }

  if (expected.kind === 'table') {
    if (!actual || typeof actual !== 'object') return 0;
    const rows = (actual as { rows?: unknown[] }).rows;
    if (!Array.isArray(rows)) return 0;
    return rows.length === expected.rows.length ? 0.9 : 0;
  }

  return String(expected) === String(actual) ? 1 : 0;
}

export function replayPassThreshold(match: number): boolean {
  return match >= 0.95;
}
