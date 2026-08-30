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
  let current: unknown = Object.hasOwn(stepResults, root) ? stepResults[root] : variables[root];
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
  const toNumber = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value !== 'string' || value.trim() === '') return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };
  const leftNum = toNumber(left);
  const rightNum = toNumber(right);
  return leftNum == null || rightNum == null ? null : leftNum - rightNum;
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

function normalizeComparisonOp(op: string): 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte' | undefined {
  const normalized = op.trim().toLowerCase();
  if (normalized === 'includes' || normalized === 'include') return 'contains';
  if (normalized === 'equals' || normalized === '==' || normalized === 'equal') return 'eq';
  if (normalized === 'notequals' || normalized === '!=' || normalized === 'not_equal') return 'neq';
  return isComparisonOp(normalized) ? normalized : undefined;
}

function readConditionOp(record: Record<string, unknown>): string {
  if (typeof record.op === 'string') return record.op.trim().toLowerCase();
  if (typeof record.operator === 'string') return record.operator.trim().toLowerCase();
  if (typeof record.comparator === 'string') return record.comparator.trim().toLowerCase();
  return '';
}

function coerceConditionRef(value: unknown): ConditionValue | undefined {
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

function coerceConditionSide(value: unknown, asLiteral: boolean): ConditionValue | undefined {
  if (value != null && typeof value === 'object') return coerceConditionValue(value);
  if (asLiteral) {
    if (typeof value === 'string') return { lit: value.trim() };
    if (typeof value === 'number' || typeof value === 'boolean') return { lit: value };
    return undefined;
  }
  return coerceConditionRef(value);
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

/** Workflow input preprocess: never throw; drop invalid filters instead of crashing IPC. */
export function preprocessConditionValue(value: unknown): ConditionExpr | undefined {
  if (value == null) return undefined;
  return tryNormalizeCondition(value);
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
