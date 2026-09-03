import { migrateLegacyCondition } from './legacy.js';
import { coerceConditionInput } from './coerce.js';
import { ConditionExprSchema, type ConditionExpr } from './schema.js';

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
