export type ConditionInputCoercer = (input: unknown) => unknown;

export function coerceCompoundCondition(
  record: Record<string, unknown>,
  op: string,
  coerce: ConditionInputCoercer,
): unknown | undefined {
  if (op === 'and' || op === 'or') {
    if (Array.isArray(record.args) && record.args.length > 0) {
      return { op, args: record.args.map(coerce) };
    }
    const args: unknown[] = [];
    for (const key of ['left', 'right', 'condition', 'arg'] as const) {
      const value = record[key];
      if (value != null) args.push(coerce(value));
    }
    if (Array.isArray(record.conditions)) {
      args.push(...record.conditions.map(coerce));
    }
    if (args.length > 0) return { op, args };
    return undefined;
  }

  if (op === 'not') {
    const arg = record.arg ?? record.left ?? record.condition;
    if (arg != null) return { op: 'not', arg: coerce(arg) };
  }
  return undefined;
}
