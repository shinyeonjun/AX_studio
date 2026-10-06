import type { ConditionExpr, ConditionValue } from './schema.js';

function numericEquality(ref: string, value: number): ConditionExpr {
  // gte+lte use numeric coercion of numeric strings, like JS `==` with a number.
  return { op: 'and', args: [
    { op: 'gte', left: { ref }, right: { lit: value } },
    { op: 'lte', left: { ref }, right: { lit: value } },
  ] };
}

/**
 * Map JS loose `==` faithfully instead of silently tightening it to `===`.
 * - number literal N: matches N or any numeric string equal to N ('05' == 5).
 * - numeric string literal 'S': matches 'S' exactly or the number Number(S)
 *   (a string ref compares as a string, as JS does: '5' == '05' is false).
 * - boolean literal: matches the boolean, or 1/0 and their numeric strings.
 * Known gaps (rare in stored conditions): '' == 0 and true == 1 with a
 * boolean ref on a number literal evaluate false here.
 */
function looseEquality(ref: string, right: ConditionValue): ConditionExpr {
  if (!('lit' in right)) return { op: 'eq', left: { ref }, right };
  const value = right.lit;
  if (typeof value === 'number') return { op: 'or', args: [{ op: 'eq', left: { ref }, right }, numericEquality(ref, value)] };
  if (typeof value === 'boolean') {
    return { op: 'or', args: [{ op: 'eq', left: { ref }, right }, numericEquality(ref, value ? 1 : 0)] };
  }
  const numeric = value.trim() === '' ? NaN : Number(value);
  if (Number.isFinite(numeric)) {
    return { op: 'or', args: [{ op: 'eq', left: { ref }, right }, { op: 'eq', left: { ref }, right: { lit: numeric } }] };
  }
  return { op: 'eq', left: { ref }, right };
}

/** Best-effort migration for legacy JS string conditions stored in older works. */
export function migrateLegacyCondition(condition: string): ConditionExpr | null {
  const trimmed = condition.trim();
  if (!trimmed) return null;

  const includesMatch = trimmed.match(/^String\(([^)]+)\)\.includes\((['"])(.*)\2\)$/);
  if (includesMatch) {
    return {
      op: 'contains',
      left: { ref: includesMatch[1].trim() },
      right: { lit: includesMatch[3] },
    };
  }

  const compareMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\s*(===|!==|==|<=|>=|<|>)\s*(.+)$/);
  if (compareMatch) {
    const [, ref, op, rawRight] = compareMatch;
    const rightText = rawRight.trim();
    let right: ConditionValue;
    if ((rightText.startsWith('"') && rightText.endsWith('"')) || (rightText.startsWith("'") && rightText.endsWith("'"))) {
      right = { lit: rightText.slice(1, -1) };
    } else if (rightText === 'true' || rightText === 'false') {
      right = { lit: rightText === 'true' };
    } else {
      const num = Number(rightText);
      right = Number.isNaN(num) ? { lit: rightText } : { lit: num };
    }

    const opMap: Record<string, 'eq' | 'neq' | 'gt' | 'gte' | 'lt' | 'lte'> = {
      '===': 'eq',
      '!==': 'neq',
      '==': 'eq',
      '<=': 'lte',
      '>=': 'gte',
      '<': 'lt',
      '>': 'gt',
    };
    const mapped = opMap[op];
    if (!mapped) return null;
    if (op === '==') return looseEquality(ref.trim(), right);
    return { op: mapped, left: { ref: ref.trim() }, right };
  }

  return null;
}
