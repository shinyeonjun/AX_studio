export type ComparisonOp = 'eq' | 'neq' | 'contains' | 'gt' | 'gte' | 'lt' | 'lte';

export function isComparisonOp(op: string): op is ComparisonOp {
  return op === 'eq' || op === 'neq' || op === 'contains' || op === 'gt' || op === 'gte' || op === 'lt' || op === 'lte';
}

export function normalizeComparisonOp(op: string): ComparisonOp | undefined {
  const normalized = op.trim().toLowerCase();
  if (normalized === 'includes' || normalized === 'include') return 'contains';
  if (normalized === 'equals' || normalized === '==' || normalized === 'equal') return 'eq';
  if (normalized === 'notequals' || normalized === '!=' || normalized === 'not_equal') return 'neq';
  return isComparisonOp(normalized) ? normalized : undefined;
}

export function readConditionOp(record: Record<string, unknown>): string {
  if (typeof record.op === 'string') return record.op.trim().toLowerCase();
  if (typeof record.operator === 'string') return record.operator.trim().toLowerCase();
  if (typeof record.comparator === 'string') return record.comparator.trim().toLowerCase();
  return '';
}
