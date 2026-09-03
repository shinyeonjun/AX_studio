import type { ConditionExpr, ConditionValue } from './schema.js';

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
    return { op: mapped, left: { ref: ref.trim() }, right };
  }

  return null;
}
