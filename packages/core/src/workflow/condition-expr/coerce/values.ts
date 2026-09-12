import type { ConditionValue } from '../schema.js';

export function coerceConditionValue(value: unknown): ConditionValue | undefined {
  if (value == null) return undefined;
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? { ref: trimmed } : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return { lit: value };
  }
  if (typeof value !== 'object' || Array.isArray(value)) return undefined;

  const record = value as Record<string, unknown>;
  if (typeof record.ref === 'string' && record.ref.trim()) {
    return { ref: record.ref.trim() };
  }
  if (typeof record.var === 'string' && record.var.trim()) {
    return { ref: record.var.trim() };
  }
  if ('lit' in record) {
    const lit = record.lit;
    if (typeof lit === 'string' || typeof lit === 'number' || typeof lit === 'boolean') {
      return { lit };
    }
  }
  if (typeof record.field === 'string' && record.field.trim()) {
    return { ref: record.field.trim() };
  }
  if (
    record.value !== undefined &&
    (typeof record.value === 'string' || typeof record.value === 'number' || typeof record.value === 'boolean')
  ) {
    return { lit: record.value };
  }
  return undefined;
}

export function coerceConditionRef(value: unknown): ConditionValue | undefined {
  if (value != null && typeof value === 'object') return coerceConditionValue(value);
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed ? { ref: trimmed } : undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return { lit: value };
  }
  return undefined;
}

export function coerceConditionSide(value: unknown, asLiteral: boolean): ConditionValue | undefined {
  if (value != null && typeof value === 'object') return coerceConditionValue(value);
  if (asLiteral) {
    if (typeof value === 'string') return { lit: value.trim() };
    if (typeof value === 'number' || typeof value === 'boolean') return { lit: value };
    return undefined;
  }
  return coerceConditionRef(value);
}
