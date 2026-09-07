import { z } from 'zod';
import { ReportLayoutPlanSchema, type ReportLayoutPlan } from '../layout/schema.js';
import { ReportPlanSchema, type ReportPlan } from '../plan/schema.js';
import { ReportPeriodSchema, ReportSourceCapturePlanSchema, type ReportPeriod, type ReportSourceCapturePlan } from '../source/schema.js';

export const ReportSourceNeedSchema = z.object({
  id: z.string().min(1).max(80),
  connector: z.enum(['http', 'rdb']),
  description: z.string().min(1).max(500),
  reason: z.string().min(1).max(500),
}).strict();
export type ReportSourceNeed = z.infer<typeof ReportSourceNeedSchema>;
export interface ReportUnavailableSource {
  connector: 'rdb';
  operation: 'schema.describe';
  available: false;
  reason: 'connector_missing' | 'schema_request_failed' | 'schema_response_invalid';
  errorCode?: string;
}
export const ReportSourceRequirementsSchema = z.object({
  schemaVersion: z.literal(1),
  requirements: z.array(ReportSourceNeedSchema).max(12),
}).strict().refine(value => new Set(value.requirements.map(item => item.id)).size === value.requirements.length,
  'Source requirement IDs must be unique');

export class ReportSourceReplanRequired extends Error {
  constructor(readonly needs: ReportSourceNeed[]) {
    super('report_source_replan_required');
  }
}

export interface ReportCaptureInference {
  schemaVersion: 1;
  examplePeriod: ReportPeriod;
  targetPeriod: ReportPeriod;
  capturePlan: ReportSourceCapturePlan;
  requirementBindings?: Array<{ requirementId: string; aliases: string[] }>;
}

export interface ReportBusinessInference {
  schemaVersion: 1;
  reportPlan: ReportPlan;
  layout: ReportLayoutPlan;
}

export const ReportCaptureInferenceSchema: z.ZodType<ReportCaptureInference> = z.object({
  schemaVersion: z.literal(1),
  examplePeriod: ReportPeriodSchema,
  targetPeriod: ReportPeriodSchema,
  capturePlan: ReportSourceCapturePlanSchema,
  requirementBindings: z.array(z.object({
    requirementId: z.string().min(1).max(80),
    aliases: z.array(z.string().min(1).max(200)).min(1).max(32),
  }).strict()).max(12).optional(),
});

/** Coverage is checked independently of the model's claim that a plan is complete. */
export function assertReportSourceCoverage(capture: ReportCaptureInference, requirements: ReportSourceNeed[]): void {
  const bindings = capture.requirementBindings ?? [];
  const missing = requirements.filter(need => {
    const matching = bindings.filter(binding => binding.requirementId === need.id);
    const aliases = new Set(capture.capturePlan[need.connector].map(source => source.alias));
    return matching.length !== 1 || matching[0]!.aliases.length === 0
      || matching[0]!.aliases.some(alias => !aliases.has(alias));
  });
  if (missing.length) throw new ReportSourceReplanRequired(missing);
  if (bindings.some(binding => !requirements.some(need => need.id === binding.requirementId))) {
    throw new Error('report_source_binding_unknown');
  }
}

export const ReportBusinessInferenceSchema: z.ZodType<ReportBusinessInference> = z.object({
  schemaVersion: z.literal(1),
  reportPlan: ReportPlanSchema,
  layout: ReportLayoutPlanSchema,
});

export const ReportCalculationInferenceSchema = z.object({
  schemaVersion: z.literal(1),
  reportPlan: ReportPlanSchema,
});

export const ReportLayoutInferenceSchema = z.object({
  schemaVersion: z.literal(1),
  layout: ReportLayoutPlanSchema,
});
