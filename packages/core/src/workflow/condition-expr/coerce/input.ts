import { migrateLegacyCondition } from '../legacy.js';
import { coerceCompoundCondition } from './compound.js';
import { isComparisonOp, normalizeComparisonOp, readConditionOp } from './operators.js';
import { coerceConditionSide } from './values.js';

/** Fix common LLM shapes before strict condition parsing. */
export function coerceConditionInput(input: unknown): unknown {
  if (input == null) return input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return undefined;
    const migrated = migrateLegacyCondition(trimmed);
    if (migrated) return migrated;
    try {
      return coerceConditionInput(JSON.parse(trimmed));
    } catch {
      return input;
    }
  }
  if (typeof input !== 'object' || Array.isArray(input)) return input;

  const record = input as Record<string, unknown>;
  if (record.when != null && typeof record.when === 'object') {
    return coerceConditionInput(record.when);
  }
  for (const key of ['expression', 'when', 'predicate'] as const) {
    if (typeof record[key] === 'string') {
      return coerceConditionInput(record[key]);
    }
  }
  if (record.compare != null && typeof record.compare === 'object') {
    return coerceConditionInput(record.compare);
  }
  if (record.condition != null && record.condition !== input) {
    return coerceConditionInput(record.condition);
  }

  if (Array.isArray(record.equals) && record.equals.length >= 2) {
    const left = coerceConditionSide(record.equals[0], false);
    const right = coerceConditionSide(record.equals[1], true);
    if (left && right) return { op: 'eq', left, right };
  }

  if (
    (record.eq !== undefined || (typeof record.equals === 'string' || typeof record.equals === 'number' || typeof record.equals === 'boolean')) &&
    (record.ref != null || record.field != null || record.variable != null)
  ) {
    const left = coerceConditionSide(record.ref ?? record.field ?? record.variable, false);
    const right = coerceConditionSide(record.eq ?? record.equals, true);
    if (left && right) return { op: 'eq', left, right };
  }

  const rawOp = readConditionOp(record);
  const op = normalizeComparisonOp(rawOp) ?? rawOp;

  if (isComparisonOp(op)) {
    const left = coerceConditionSide(
      record.left ?? record.field ?? record.variable ?? record.lhs,
      false,
    );
    const right = coerceConditionSide(record.right ?? record.value ?? record.rhs, true);
    if (left && right) return { op, left, right };
    return input;
  }

  if (!rawOp && (record.field != null || record.variable != null) && record.value !== undefined) {
    const left = coerceConditionSide(record.field ?? record.variable, false);
    const right = coerceConditionSide(record.value, true);
    if (left && right) {
      const ref = 'ref' in left ? left.ref : '';
      const defaultOp = ref.includes('.') ? 'eq' : 'contains';
      return { op: defaultOp, left, right };
    }
  }

  const compound = coerceCompoundCondition(record, op, coerceConditionInput);
  return compound ?? input;
}
