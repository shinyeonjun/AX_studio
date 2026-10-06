import { z } from 'zod';

export const ConditionValueSchema = z.union([
  z.object({ ref: z.string().min(1) }),
  z.object({ lit: z.union([z.string(), z.number(), z.boolean()]) }),
]);

export type ConditionValue = z.infer<typeof ConditionValueSchema>;

/** Maximum JSON nesting accepted for stored/LLM-authored ConditionExpr and TransformExpr trees. */
export const MAX_EXPRESSION_NESTING_DEPTH = 64;

/** Bounded walk: never recurses deeper than the limit, so hostile input cannot overflow the stack. */
export function exceedsNestingDepth(value: unknown, limit = MAX_EXPRESSION_NESTING_DEPTH): boolean {
  if (!value || typeof value !== 'object') return false;
  if (limit <= 0) return true;
  const children = Array.isArray(value) ? value : Object.values(value as Record<string, unknown>);
  return children.some((child) => exceedsNestingDepth(child, limit - 1));
}

/** Rejects over-deep input before the recursive schema descends into it. */
export function depthLimited<T>(schema: z.ZodType<T>, label: string): z.ZodType<T> {
  return z.custom<T>((value) => !exceedsNestingDepth(value), {
    message: `${label} 중첩 깊이가 ${MAX_EXPRESSION_NESTING_DEPTH}를 넘습니다.`,
  }).pipe(schema);
}

export const ConditionExprSchema: z.ZodType<ConditionExpr> = depthLimited(z.lazy(() =>
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
), 'ConditionExpr');

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
