import { z } from 'zod';
import { ReportLayoutPlanSchema, type ReportLayoutPlan } from '../layout/schema.js';
import { ReportPlanSchema, type ReportPlan } from '../plan/schema.js';
import { ReportPeriodSchema, ReportSourceCapturePlanSchema, type ReportPeriod, type ReportSourceCapturePlan } from '../source/schema.js';

export interface ReportCaptureInference {
  schemaVersion: 1;
  examplePeriod: ReportPeriod;
  targetPeriod: ReportPeriod;
  capturePlan: ReportSourceCapturePlan;
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
});

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
