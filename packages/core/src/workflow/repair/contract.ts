import { z } from 'zod';

export const RepairColumnNameSchema = z.string().trim().min(1).max(200);

export const RepairCandidateOperationSchema = z.object({
  id: z.string().trim().min(1).max(120),
  op: z.literal('rename_column'),
  sourceId: z.string().trim().min(1).max(200),
  stepId: z.string().trim().min(1).max(200),
  from: RepairColumnNameSchema,
  to: RepairColumnNameSchema,
  expectedType: z.string().trim().min(1).max(40),
  actualType: z.string().trim().min(1).max(40),
  confidence: z.number().finite().min(0).max(1),
});

export type RepairCandidateOperation = z.infer<typeof RepairCandidateOperationSchema>;

export const RepairReplayCaseSchema = z.object({
  caseId: z.string().trim().min(1).max(200),
  exampleId: z.string().trim().min(1).max(200),
  pass: z.boolean(),
  reason: z.string().trim().min(1).max(160).optional(),
});

export const RepairReplaySummarySchema = z.object({
  status: z.enum(['not_run', 'passed', 'failed', 'unavailable']),
  total: z.number().int().nonnegative(),
  passed: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  cases: z.array(RepairReplayCaseSchema).max(128).default([]),
  reason: z.string().trim().min(1).max(200).optional(),
});

export type RepairReplayCase = z.infer<typeof RepairReplayCaseSchema>;
export type RepairReplaySummary = z.infer<typeof RepairReplaySummarySchema>;

export const RepairProposalSchema = z.object({
  id: z.string().trim().min(1).max(120),
  workflowId: z.string().trim().min(1).max(200),
  baseVersion: z.number().int().min(1),
  status: z.enum(['proposed', 'applied', 'rejected']),
  candidates: z.array(RepairCandidateOperationSchema).min(1).max(20),
  replay: RepairReplaySummarySchema,
  appliedVersion: z.number().int().min(1).optional(),
  rejectionReason: z.string().trim().min(1).max(500).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export type RepairProposal = z.infer<typeof RepairProposalSchema>;
