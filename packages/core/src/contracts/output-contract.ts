import { z } from 'zod';
import { TableColumnTypeSchema, type TableColumnType } from './artifacts/table.js';

/** Output value kinds observed by Work Discovery and checked at runtime. */
export const OutputContractValueKindSchema = z.enum([
  'number',
  'text',
  'date',
  'table',
  'list',
  'image',
]);

export const InputContractColumnTypeSchema = TableColumnTypeSchema;

/**
 * Only aggregate metadata is persisted. Raw historical output values are
 * deliberately not part of this contract.
 */
export const OutputContractFieldBaselineSchema = z.object({
  sampleCount: z.number().int().nonnegative(),
  numericMin: z.number().finite().optional(),
  numericMax: z.number().finite().optional(),
  numericToleranceRatio: z.number().finite().min(0).max(1).optional(),
  rowCountMin: z.number().int().nonnegative().optional(),
  rowCountMax: z.number().int().nonnegative().optional(),
  rowCountToleranceRatio: z.number().finite().min(0).max(1).optional(),
});

export const OutputContractFieldSchema = z.object({
  path: z.string().trim().min(1).max(200),
  kind: OutputContractValueKindSchema,
  required: z.boolean().default(true),
  baseline: OutputContractFieldBaselineSchema,
});

export const InputContractColumnSchema = z.object({
  name: z.string().trim().min(1).max(200),
  type: InputContractColumnTypeSchema.default('unknown'),
});

/**
 * A source id names a file by its folder and path, URL-encoded: one 한글 character is nine
 * characters, so a real path ("월간 보고/2026년 주문내역_서울지점.xlsx") passes 200 easily.
 */
export const MAX_SOURCE_ID_LENGTH = 4096;

export const InputContractSchema = z.object({
  sourceId: z.string().trim().min(1).max(MAX_SOURCE_ID_LENGTH),
  stepId: z.string().trim().min(1).max(200),
  columns: z.array(InputContractColumnSchema).max(128).default([]),
});

export const OutputContractSchema = z.object({
  version: z.literal(1).default(1),
  fields: z.array(OutputContractFieldSchema).max(200).default([]),
  inputSchemas: z.array(InputContractSchema).max(50).default([]),
});

export type OutputContractValueKind = z.infer<typeof OutputContractValueKindSchema>;
export type InputContractColumnType = TableColumnType;
export type OutputContractFieldBaseline = z.infer<typeof OutputContractFieldBaselineSchema>;
export type OutputContractField = z.infer<typeof OutputContractFieldSchema>;
export type InputContractColumn = z.infer<typeof InputContractColumnSchema>;
export type InputContract = z.infer<typeof InputContractSchema>;
export type OutputContract = z.infer<typeof OutputContractSchema>;
