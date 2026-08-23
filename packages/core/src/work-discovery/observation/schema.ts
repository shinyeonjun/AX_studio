import { z } from 'zod';

export const ObservationValueSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('text'), value: z.string() }),
  z.object({
    kind: z.literal('number'),
    value: z.number(),
    unit: z.string().optional(),
    display: z.string().optional(),
  }),
  z.object({ kind: z.literal('date'), value: z.string(), display: z.string().optional() }),
  z.object({
    kind: z.literal('table'),
    columns: z.array(z.string()),
    rows: z.array(z.record(z.union([z.string(), z.number(), z.boolean(), z.null()]))),
  }),
  z.object({ kind: z.literal('list'), items: z.array(z.unknown()) }),
  z.object({ kind: z.literal('image'), artifactId: z.string(), caption: z.string().optional() }),
]);

export const OutputObservationSchema = z.object({
  id: z.string(),
  exampleId: z.string(),
  path: z.string(),
  label: z.string().optional(),
  value: ObservationValueSchema,
  location: z.object({
    pageIndex: z.number().int().nonnegative().optional(),
    section: z.string().optional(),
    blockId: z.string().optional(),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]).optional(),
  }).optional(),
  role: z.enum(['dynamic_value', 'stable_structure', 'generated_narrative', 'unknown']).default('unknown'),
  required: z.boolean().default(true),
});

export type ObservationValue = z.infer<typeof ObservationValueSchema>;
export type OutputObservation = z.infer<typeof OutputObservationSchema>;
