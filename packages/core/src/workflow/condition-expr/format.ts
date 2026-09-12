import { tryNormalizeCondition } from './normalize.js';
import type { ConditionExpr } from './schema.js';

export function formatCondition(expr: ConditionExpr): string {
  switch (expr.op) {
    case 'not':
      return 'not(' + formatCondition(expr.arg) + ')';
    case 'and':
    case 'or':
      return expr.op + '(' + expr.args.map(formatCondition).join(', ') + ')';
    default: {
      const left = 'lit' in expr.left ? JSON.stringify(expr.left.lit) : expr.left.ref;
      const right = 'lit' in expr.right ? JSON.stringify(expr.right.lit) : expr.right.ref;
      return left + ' ' + expr.op + ' ' + right;
    }
  }
}

/** Normalize legacy/LLM shapes before display; never throws. */
export function safeFormatCondition(input: unknown, fallback = '?'): string {
  const normalized = tryNormalizeCondition(input);
  if (!normalized) return fallback;
  try {
    return formatCondition(normalized);
  } catch {
    return fallback;
  }
}
