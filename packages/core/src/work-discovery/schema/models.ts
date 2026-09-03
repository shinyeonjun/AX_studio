import { z } from 'zod';
import { TransformExprSchema } from '../../workflow/transform-expr/dsl.js';
import { OutputObservationSchema } from '../observation/schema.js';
import { ClarificationQuestionSchema } from '../clarification/types.js';
import { OutputContractSchema } from '../../contracts/output-contract.js';
import { DiscoveryRecoveryCheckpointSchema, DiscoveryStatusSchema } from './status.js';

export const SourceDescriptorSchema = z.object({
  id: z.string(),
  connector: z.string(),
  label: z.string(),
  kind: z.enum(['table', 'workbook', 'document', 'email', 'unknown']).default('unknown'),
  relevance: z.number().min(0).max(1).default(0),
  profileSummary: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});

export const CandidateProgramSchema = z.object({
  id: z.string(),
  observationPath: z.string(),
  expr: TransformExprSchema,
  score: z.object({
    total: z.number().min(0).max(1),
    replay: z.number().min(0).max(1),
    simplicity: z.number().min(0).max(1),
  }),
  replayResults: z.array(z.object({
    exampleId: z.string(),
    expected: z.unknown(),
    actual: z.unknown(),
    match: z.number().min(0).max(1),
    pass: z.boolean(),
  })).default([]),
  status: z.enum(['candidate', 'accepted', 'rejected', 'needs_clarification']).default('candidate'),
});

export const DiscoveryBlueprintSchema = z.object({
  id: z.string(),
  sessionId: z.string(),
  name: z.string(),
  goal: z.string(),
  triggerProposal: z.unknown().optional(),
  sources: z.array(z.object({
    id: z.string(),
    connector: z.string(),
    metadata: z.record(z.unknown()).optional(),
  })).default([]),
  fields: z.array(z.object({
    outputPath: z.string(),
    label: z.string().optional(),
    mapping: TransformExprSchema.optional(),
    confidence: z.number().min(0).max(1),
    status: z.enum(['resolved', 'ambiguous', 'unresolved', 'human_defined']),
  })),
  replaySummary: z.object({
    total: z.number().int().nonnegative(),
    passed: z.number().int().nonnegative(),
    failed: z.number().int().nonnegative(),
  }),
  outputContract: OutputContractSchema.optional(),
  publishable: z.boolean(),
});

export const DiscoverySessionStateSchema = z.object({
  id: z.string(),
  status: DiscoveryStatusSchema,
  revision: z.number().int().nonnegative(),
  userGoal: z.string(),
  exampleIds: z.array(z.string()),
  desiredRecurrence: z.string().optional(),
  recoveryCheckpoint: DiscoveryRecoveryCheckpointSchema.optional(),
  autoRecoveryAttempts: z.number().int().nonnegative().optional(),
  sourceInventory: z.array(SourceDescriptorSchema).default([]),
  observations: z.array(OutputObservationSchema).default([]),
  candidates: z.array(CandidateProgramSchema).default([]),
  pendingQuestion: ClarificationQuestionSchema.optional(),
  blueprint: DiscoveryBlueprintSchema.optional(),
  publishedWorkflowId: z.string().optional(),
  budgets: z.object({
    sourceReadsUsed: z.number().int().nonnegative(),
    sourceReadsMax: z.number().int().positive(),
    elapsedMs: z.number().int().nonnegative(),
    stoppedReason: z.string().optional(),
  }),
  createdAt: z.string(),
  updatedAt: z.string(),
  errorCode: z.string().optional(),
  errorMessage: z.string().optional(),
});

export type SourceDescriptor = z.infer<typeof SourceDescriptorSchema>;
export type CandidateProgram = z.infer<typeof CandidateProgramSchema>;
export type DiscoveryBlueprint = z.infer<typeof DiscoveryBlueprintSchema>;
export type DiscoverySessionState = z.infer<typeof DiscoverySessionStateSchema>;
