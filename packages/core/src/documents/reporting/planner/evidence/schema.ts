import { z } from 'zod';
import { ReportCalculationInferenceSchema, ReportSourceNeedSchema } from '../schema.js';

// Keep one evidence read bounded while allowing a complete business row
// sample (order id, dates, status and amount fields) in a single request.
// The response is still capped below, and duplicate columns are normalized
// before execution.
const Columns = z.array(z.string().min(1).max(200)).min(1).max(12);
export const ReportEvidenceRequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('rows'), source: z.string().min(1).max(200),
    columns: Columns, offset: z.number().int().min(0).max(100_000),
    limit: z.number().int().min(1).max(25) }).strict(),
  z.object({ kind: z.literal('profile'), source: z.string().min(1).max(200),
    columns: Columns }).strict(),
  z.object({ kind: z.literal('page'), document: z.enum(['template', 'example']),
    pageIndex: z.number().int().min(0) }).strict(),
]);
export type ReportEvidenceRequest = z.infer<typeof ReportEvidenceRequestSchema>;
export const MAX_EVIDENCE_REQUESTS = 32;
// A top-level object is required by Codex structured output. Exactly one payload
// is still enforced by the host after restoring the provider wire format.
export const ReportEvidenceDecisionSchema = z.object({
  schemaVersion: z.literal(1),
  reportPlan: ReportCalculationInferenceSchema.shape.reportPlan.optional(),
  evidenceRequests: z.array(ReportEvidenceRequestSchema).min(1).max(MAX_EVIDENCE_REQUESTS).optional(),
  // Accept responses produced by older prompts while advertising the batched form below.
  evidenceRequest: ReportEvidenceRequestSchema.optional(),
  sourceRequest: z.array(ReportSourceNeedSchema).min(1).max(12).optional(),
  unableToPlan: z.enum(['insufficient_evidence', 'ambiguous_rule', 'unsupported_operation']).optional(),
}).strict().refine((value) => {
  const evidencePayloads = Number(Boolean(value.evidenceRequests)) + Number(Boolean(value.evidenceRequest));
  return evidencePayloads <= 1
    && Number(Boolean(value.reportPlan)) + Number(evidencePayloads > 0)
      + Number(Boolean(value.sourceRequest)) + Number(Boolean(value.unableToPlan)) === 1;
}, 'Return exactly one of reportPlan, evidenceRequests, sourceRequest or unableToPlan');
