import { z } from 'zod';

export const ConditionValueSchema = z.union([
  z.object({ ref: z.string().min(1) }),
  z.object({ lit: z.union([z.string(), z.number(), z.boolean()]) }),
]);

export type ConditionValue = z.infer<typeof ConditionValueSchema>;

export const ConditionExprSchema: z.ZodType<ConditionExpr> = z.lazy(() =>
  z.union([
    z.object({
      op: z.enum(['eq', 'neq', 'contains', 'gt', 'gte', 'lt', 'lte']),
      left: ConditionValueSchema,
      right: ConditionValueSchema,
    }),
    z.object({
      op: z.enum(['and', 'or']),
      args: z.array(ConditionExprSchema).min(1),
    }),
    z.object({
      op: z.literal('not'),
      arg: ConditionExprSchema,
    }),
  ]),
);

export type ConditionExpr = {
  op: 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte';
  left: ConditionValue;
  right: ConditionValue;
} | {
  op: 'and' | 'or';
  args: ConditionExpr[];
} | {
  op: 'not';
  arg: ConditionExpr;
};

function resolveRef(ref: string, variables: Record<string, unknown>, stepResults: Record<string, unknown>): unknown {
  const path = ref.startsWith('trigger.') ? ref.slice('trigger.'.length) : ref;
  const [root, ...rest] = path.split('.');
  let current: unknown = stepResults[root] ?? variables[root];
  for (const key of rest) {
    if (current == null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function resolveValue(
  value: ConditionValue,
  variables: Record<string, unknown>,
  stepResults: Record<string, unknown>,
): unknown {
  if ('lit' in value) return value.lit;
  return resolveRef(value.ref, variables, stepResults);
}

function compareValues(left: unknown, right: unknown): number | null {
  if (typeof left === 'number' && typeof right === 'number') return left - right;
  const leftNum = Number(left);
  const rightNum = Number(right);
  if (!Number.isNaN(leftNum) && !Number.isNaN(rightNum) && `${left}`.trim() !== '' && `${right}`.trim() !== '') {
    return leftNum - rightNum;
  }
  return null;
}

export function evaluateCondition(
  expr: ConditionExpr,
  variables: Record<string, unknown>,
  stepResults: Record<string, unknown>,
): boolean {
  switch (expr.op) {
    case 'eq':
      return resolveValue(expr.left, variables, stepResults) === resolveValue(expr.right, variables, stepResults);
    case 'neq':
      return resolveValue(expr.left, variables, stepResults) !== resolveValue(expr.right, variables, stepResults);
    case 'contains': {
      const left = resolveValue(expr.left, variables, stepResults);
      const right = resolveValue(expr.right, variables, stepResults);
      if (left == null || right == null) return false;
      return String(left).includes(String(right));
    }
    case 'gt':
    case 'gte':
    case 'lt':
    case 'lte': {
      const cmp = compareValues(
        resolveValue(expr.left, variables, stepResults),
        resolveValue(expr.right, variables, stepResults),
      );
      if (cmp == null) return false;
      if (expr.op === 'gt') return cmp > 0;
      if (expr.op === 'gte') return cmp >= 0;
      if (expr.op === 'lt') return cmp < 0;
      return cmp <= 0;
    }
    case 'and':
      return expr.args.every((arg) => evaluateCondition(arg, variables, stepResults));
    case 'or':
      return expr.args.some((arg) => evaluateCondition(arg, variables, stepResults));
    case 'not':
      return !evaluateCondition(expr.arg, variables, stepResults);
    default:
      return false;
  }
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

  const compareMatch = trimmed.match(/^([a-zA-Z0-9_.]+)\s*(===|!==|<=|>=|<|>)\s*(.+)$/);
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

function isComparisonOp(op: string): op is 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' {
  return op === 'eq' || op === 'neq' || op === 'contains' || op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte';
}

function coerceConditionValue(value: unknown): ConditionValue | undefined {
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
  const op = typeof record.op === 'string' ? record.op.trim().toLowerCase() : '';

  if (isComparisonOp(op)) {
    const left = coerceConditionValue(record.left);
    const right = coerceConditionValue(record.right);
    if (left && right) return { op, left, right };
    return input;
  }

  if (op === 'and' || op === 'or') {
    if (Array.isArray(record.args) && record.args.length > 0) {
      return { op, args: record.args.map(coerceConditionInput) };
    }
    const args: unknown[] = [];
    for (const key of ['left', 'right', 'condition', 'arg'] as const) {
      const value = record[key];
      if (value != null) args.push(coerceConditionInput(value));
    }
    if (Array.isArray(record.conditions)) {
      args.push(...record.conditions.map(coerceConditionInput));
    }
    if (args.length > 0) return { op, args };
    return input;
  }

  if (op === 'not') {
    const arg = record.arg ?? record.left ?? record.condition;
    if (arg != null) return { op: 'not', arg: coerceConditionInput(arg) };
    return input;
  }

  return input;
}

export function tryNormalizeCondition(input: unknown): ConditionExpr | undefined {
  try {
    return normalizeCondition(input);
  } catch {
    return undefined;
  }
}

export function normalizeCondition(input: unknown): ConditionExpr {
  const coerced = coerceConditionInput(input);
  const parsed = ConditionExprSchema.safeParse(coerced);
  if (parsed.success) return parsed.data;
  if (typeof coerced === 'string') {
    const migrated = migrateLegacyCondition(coerced);
    if (migrated) return migrated;
  }
  throw new Error('Invalid condition expression');
}

export function formatCondition(expr: ConditionExpr): string {
  switch (expr.op) {
    case 'not':
      return `not(${formatCondition(expr.arg)})`;
    case 'and':
    case 'or':
      return `${expr.op}(${expr.args.map(formatCondition).join(', ')})`;
    default: {
      const left = 'lit' in expr.left ? JSON.stringify(expr.left.lit) : expr.left.ref;
      const right = 'lit' in expr.right ? JSON.stringify(expr.right.lit) : expr.right.ref;
      return `${left} ${expr.op} ${right}`;
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
