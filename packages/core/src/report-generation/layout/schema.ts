import { z } from 'zod';

export type ReportLayoutValue =
  | { kind: 'scalar'; id: string }
  | { kind: 'text'; id: string }
  | { kind: 'metadata'; key: string };

export interface ReportLayoutPlan {
  schemaVersion: 1;
  outputFileName: string;
  scalarBindings: Array<{ slotId: string; value: ReportLayoutValue }>;
  tableBindings: Array<{
    groupId: string;
    tableId: string;
    columns: Array<{ columnIndex: number; columnId: string }>;
  }>;
}

const ValueSchema: z.ZodType<ReportLayoutValue> = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('scalar'), id: z.string().min(1) }),
  z.object({ kind: z.literal('text'), id: z.string().min(1) }),
  z.object({ kind: z.literal('metadata'), key: z.string().min(1) }),
]);

export const ReportLayoutPlanSchema: z.ZodType<ReportLayoutPlan> = z.object({
  schemaVersion: z.literal(1),
  outputFileName: z.string().trim().min(1).max(180).refine((value) => value.toLowerCase().endsWith('.pdf')),
  scalarBindings: z.array(z.object({
    slotId: z.string().min(1),
    value: ValueSchema,
  })).max(300),
  tableBindings: z.array(z.object({
    groupId: z.string().min(1),
    tableId: z.string().min(1),
    columns: z.array(z.object({
      columnIndex: z.number().int().nonnegative(),
      columnId: z.string().min(1),
    })).min(1).max(50),
  })).max(50),
});
