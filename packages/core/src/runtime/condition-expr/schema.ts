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
