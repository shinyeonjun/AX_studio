import { z } from 'zod';
import type { InvestigationRunner } from '../../../intelligence/agent/investigation-runner.js';
import type { InvestigateAgentContext } from '../../../intelligence/agent/types.js';
import type { ModelImageInput } from '../../../intelligence/agent/model/provider.js';
import { normalizeReportHttpPath, ReportHttpPathSchema, ReportPeriodSchema, ReportSourceCapturePlanSchema } from '../source/schema.js';
import { assertReportSourceCoverage, ReportSourceReplanRequired, type ReportCaptureInference, type ReportSourceNeed } from './schema.js';

// Source discovery may require several bounded catalog/schema inspections before
// the model can bind opaque connector labels to a reusable capture plan. Keep a
// finite aggregate budget, but allow the serial inspection path enough time to
// finish when each connector call is healthy.
export const REPORT_SOURCE_DISCOVERY_TIMEOUT_MS = 300_000;

const RequestSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('catalog'), connector: z.enum(['http', 'rdb']).optional(),
    query: z.string().trim().max(200).optional(), connectionId: z.string().min(1).max(160).optional(),
    offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(), limit: z.number().int().min(1).max(20).optional() }).strict(),
  z.object({ kind: z.literal('http_operation'), connectionId: z.string().min(1).max(160), path: ReportHttpPathSchema }).strict(),
  z.object({ kind: z.literal('rdb_table'), table: z.string().min(1).max(160),
    offset: z.number().int().min(0).max(1_000_000).optional(), limit: z.number().int().min(1).max(200).optional() }).strict(),
  z.object({ kind: z.literal('http_connection'), connectionId: z.string().min(1).max(160), path: ReportHttpPathSchema }).strict(),
]);
export type ReportSourceInspection = z.infer<typeof RequestSchema>;

/** Validated model clarification is user-facing text, never an executable action. */
export class ReportSourceClarificationRequired extends Error {
  constructor(readonly clarification: string) {
    super('report_source_discovery_needs_input');
  }
}
// The provider-facing request must remain an object. A discriminated union is
// encoded as a JSON string by the Codex adapter, which makes it too easy for a
// model to put the explanation in `reason` while leaving the request absent.
const RequestWireSchema = z.object({
  kind: z.enum(['catalog', 'http_operation', 'rdb_table', 'http_connection']),
  table: z.string().min(1).max(160).optional(),
  connectionId: z.string().min(1).max(160).optional(),
  path: ReportHttpPathSchema.optional(),
  connector: z.enum(['http', 'rdb']).optional().describe('Only for kind=catalog. For other kinds omit this field (null on nullable wire schemas).'),
  query: z.string().trim().max(200).optional(),
  offset: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).optional(),
  limit: z.number().int().min(1).max(200).optional(),
}).strict();
const PlannedSchema = z.object({
  schemaVersion: z.literal(1),
  examplePeriod: ReportPeriodSchema,
  targetPeriod: ReportPeriodSchema,
  capturePlan: ReportSourceCapturePlanSchema,
  requirementBindings: z.array(z.object({
    requirementId: z.string().min(1).max(80),
    aliases: z.array(z.string().min(1).max(200)).min(1).max(32),
  }).strict()).max(12),
}).strict().refine(value => value.capturePlan.http.length + value.capturePlan.rdb.length > 0,
  'A planned response must select at least one source');

// This schema is deliberately structural. The host restores the discriminated
// request and applies the semantic status/payload contract below so a bounded
// correction turn can recover from a model response with the wrong combination
// of fields without ever executing an unvalidated request.
function normalizeSourceDecisionWire(value: unknown): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value;
  const record = value as Record<string, unknown>;
  const request = record.request;
  if (!request || typeof request !== 'object' || Array.isArray(request)) return value;
  const requestRecord = request as Record<string, unknown>;
  // HTTP inspection kinds already encode their connector in `kind`. Some
  // models redundantly emit the matching connector; discard only that
  // unambiguous annotation so the strict wire contract still rejects a
  // contradictory connector or unrelated extra fields.
  if ((requestRecord.kind === 'http_operation' || requestRecord.kind === 'http_connection')
    && requestRecord.connector === 'http') {
    const { connector: _connector, ...withoutConnector } = requestRecord;
    return { ...record, request: withoutConnector };
  }
  return value;
}

export const ReportSourceDecisionWireSchema = z.preprocess(normalizeSourceDecisionWire, z.object({
  schemaVersion: z.literal(1),
  status: z.enum(['planned', 'need_evidence', 'needs_input', 'unsupported']),
  plan: PlannedSchema.optional(),
  request: RequestWireSchema.optional(),
  reason: z.string().trim().min(1).max(1000).optional(),
}).strict());

// Keep old checkpoint capture records readable. Only new model decisions use this contract.
export const ReportSourceDecisionSchema = z.object({
  schemaVersion: z.literal(1),
  status: z.enum(['planned', 'need_evidence', 'needs_input', 'unsupported']),
  plan: PlannedSchema.optional(),
  request: RequestSchema.optional(),
  reason: z.string().trim().min(1).max(1000).optional(),
}).strict().superRefine((value, ctx) => {
  const valid = value.status === 'planned'
    ? !!value.plan && !value.request && !value.reason
    : value.status === 'need_evidence'
      ? !!value.request && !value.plan && !value.reason
      : !!value.reason && !value.plan && !value.request;
  if (!valid) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Return exactly the fields for the selected status' });
});

type DecisionValidationIssue = { code: string; path: (string | number)[]; keys?: string[] };

function decisionIssue(issue: z.ZodIssue): DecisionValidationIssue {
  return { code: issue.code, path: issue.path,
    ...(issue.code === 'unrecognized_keys' ? { keys: issue.keys.slice(0, 12).map(key => key.slice(0, 80)) } : {}) };
}

function validationFeedback(value: unknown, issues: DecisionValidationIssue[]) {
  const record = value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
  const providedFields = ['plan', 'request', 'reason'].filter(key => (
    !!record && Object.hasOwn(record, key) && record[key] !== null && record[key] !== undefined
  ));
  return {
    status: typeof record?.status === 'string' ? record.status : 'unknown',
    providedFields,
    validationIssues: issues.slice(0, 4),
  };
}

function inspectionSucceeded(value: unknown): boolean {
  return !(value && typeof value === 'object' && 'available' in value && value.available === false);
}

function inspectionKey(request: ReportSourceInspection): string {
  if (request.kind === 'catalog') {
    const query = request.query?.toLowerCase().split(/\s+/).filter(Boolean).sort().join(' ');
    return JSON.stringify({ kind: request.kind, connector: request.connector, query: query || undefined,
      connectionId: request.connectionId, offset: request.offset ?? 0, limit: request.limit ?? 8 });
  }
  if (request.kind === 'rdb_table') {
    return JSON.stringify({ kind: request.kind, table: request.table, offset: request.offset ?? 0,
      limit: request.limit ?? 20 });
  }
  if (request.kind === 'http_operation') {
    const path = normalizeReportHttpPath(request.path);
    return JSON.stringify({ kind: request.kind, connectionId: request.connectionId,
      path: new URL(path, 'http://report-probe.invalid').pathname });
  }
  return JSON.stringify({ kind: request.kind, connectionId: request.connectionId,
    path: normalizeReportHttpPath(request.path) });
}

function parseSourceDecision(value: unknown):
  | { ok: true; decision: z.infer<typeof ReportSourceDecisionSchema> }
  | { ok: false; issues: DecisionValidationIssue[]; feedback: ReturnType<typeof validationFeedback> } {
  const wire = ReportSourceDecisionWireSchema.safeParse(value);
  if (!wire.success) {
    const issues = wire.error.issues.map(decisionIssue);
    return { ok: false, issues, feedback: validationFeedback(value, issues) };
  }
  const decision = ReportSourceDecisionSchema.safeParse(wire.data);
  if (!decision.success) {
    const issues = decision.error.issues.map(decisionIssue);
    return { ok: false, issues, feedback: validationFeedback(value, issues) };
  }
  return { ok: true, decision: decision.data };
}

function invalidModelOutput(issues: DecisionValidationIssue[]): Error {
  return Object.assign(new Error('model_output_invalid'), {
    code: 'model_output_invalid',
    issues: issues.slice(0, 12),
  });
}

export async function discoverReportSources(input: {
  runner: InvestigationRunner;
  context: InvestigateAgentContext;
  user: string;
  images: ModelImageInput[];
  requirements: ReportSourceNeed[];
  initialEvidence?: Array<{ request: ReportSourceInspection; result: unknown }>;
  prepare?: (signal: AbortSignal) => Promise<Array<{ request: ReportSourceInspection; result: unknown }>>;
  signal?: AbortSignal;
  maxChars?: number;
  inspect?: (request: ReportSourceInspection, abortSignal?: AbortSignal) => Promise<unknown>;
  validate: (plan: ReportCaptureInference, evidence: Array<{ request: ReportSourceInspection; result: unknown }>,
    signal: AbortSignal) => ReportCaptureInference | Promise<ReportCaptureInference>;
}): Promise<ReportCaptureInference> {
  const evidence = [...(input.initialEvidence ?? [])];
  if (evidence.some(item => JSON.stringify(item.result).length > 24_000)) {
    throw new Error('report_source_discovery_evidence_limit');
  }
  const seen = new Set(evidence.map(item => inspectionKey(item.request)));
  const rejectedPlans = new Set<string>();
  const repeatedInspections = new Set<string>();
  const planFeedback: Array<{ missingRequirementIds: string[] } | { validationError: string }> = [];
  const decisionFeedback: Array<ReturnType<typeof validationFeedback>> = [];
  let decisionCorrectionAttempts = 0;
  let needsInputCorrectionAttempts = 0;
  let agentTimeoutRetries = 0;
  let inspectionCount = 0;
  let visualEvidenceNeeded = input.images.length > 0;
  const started = Date.now();
  const controller = new AbortController();
  const requestSignal = input.signal
    ? AbortSignal.any([controller.signal, input.signal])
    : controller.signal;
  const withinDeadline = async <T>(run: () => Promise<T>): Promise<T> => {
    if (requestSignal.aborted) throw Object.assign(new Error('agent_aborted'), { code: 'agent_aborted' });
    let timer: ReturnType<typeof setTimeout> | undefined;
    let abortListener: (() => void) | undefined;
    let settleCancellation!: (error: Error) => void;
    const cancelled = new Promise<Error>((resolve) => {
      settleCancellation = resolve;
      timer = setTimeout(() => {
        resolve(new Error('report_source_discovery_deadline'));
        controller.abort();
      }, Math.max(0, REPORT_SOURCE_DISCOVERY_TIMEOUT_MS - (Date.now() - started)));
      abortListener = () => resolve(Object.assign(new Error('agent_aborted'), { code: 'agent_aborted' }));
      if (requestSignal.aborted) abortListener();
      else requestSignal.addEventListener('abort', abortListener, { once: true });
    });
    try {
      const outcome = await Promise.race([
        run().then(value => ({ kind: 'result' as const, value })),
        cancelled.then(error => ({ kind: 'cancelled' as const, error })),
      ]);
      if (outcome.kind === 'cancelled') throw outcome.error;
      return outcome.value;
    } finally {
      clearTimeout(timer);
      if (abortListener) requestSignal.removeEventListener('abort', abortListener);
      settleCancellation(new Error('report_source_discovery_completed'));
    }
  };
  if (input.prepare) {
    const prepared = await withinDeadline(() => input.prepare!(requestSignal));
    if (prepared.some(item => JSON.stringify(item.result).length > 24_000)) {
      throw new Error('report_source_discovery_evidence_limit');
    }
    evidence.push(...prepared);
    for (const item of prepared) seen.add(inspectionKey(item.request));
  }
  // Metadata paging is useful work, not a failed plan revision. Reserve a model
  // decision after the final permitted inspection; keep all budgets finite.
  const maxInspections = 24;
  const maxPlanRevisions = 6;
  const baseUntrustedData = JSON.parse(input.context.untrustedData ?? '{}');
  for (let round = 0; round < maxInspections + maxPlanRevisions + 2; round++) {
    if (input.signal?.aborted) throw Object.assign(new Error('agent_aborted'), { code: 'agent_aborted' });
    if (Date.now() - started > REPORT_SOURCE_DISCOVERY_TIMEOUT_MS) throw new Error('report_source_discovery_deadline');
    const untrustedData = JSON.stringify({ ...baseUntrustedData, inspectedEvidence: evidence, planFeedback, decisionFeedback,
      discoveryBudget: { remainingInspections: maxInspections - inspectionCount,
        remainingPlanRevisions: maxPlanRevisions - rejectedPlans.size } });
    if (untrustedData.length > Math.min(input.maxChars ?? 600_000, 600_000)) throw new Error('report_planning_context_too_large');
    let result: { output: unknown };
    try {
      result = await withinDeadline(() => input.runner.run({
        outputSchema: ReportSourceDecisionWireSchema,
        context: { ...input.context, untrustedData }, user: input.user,
        ...(visualEvidenceNeeded ? { images: input.images } : {}),
        logContext: round === 0 ? 'report-source-plan' : evidence.length > 0
          ? `report-source-plan-inspect-${round}` : `report-source-plan-retry-${round}`,
        abortSignal: requestSignal,
      }));
    } catch (error) {
      if (input.signal?.aborted) throw Object.assign(new Error('agent_aborted'), { code: 'agent_aborted' });
      if (error && typeof error === 'object' && 'code' in error
        && error.code === 'agent_timeout' && agentTimeoutRetries < 1) {
        // A provider timeout is transient more often than it is a source
        // defect. Re-run the decision once with the evidence already captured;
        // the aggregate deadline still bounds the total discovery work.
        agentTimeoutRetries += 1;
        planFeedback.push({ validationError: 'report_source_agent_timeout_recheck' });
        continue;
      }
      const invalid = error instanceof z.ZodError || (error && typeof error === 'object'
        && 'code' in error && error.code === 'model_output_invalid');
      if (!invalid || decisionCorrectionAttempts >= 1) throw error;
      decisionCorrectionAttempts += 1;
      const providerIssues = z.object({ issues: z.array(z.object({
        code: z.string().max(80),
        path: z.array(z.union([z.string().max(160), z.number().int()])).max(32),
      })).max(12) }).safeParse(error);
      const issues = error instanceof z.ZodError ? error.issues.map(decisionIssue)
        : providerIssues.success && providerIssues.data.issues.length > 0 ? providerIssues.data.issues
          : [{ code: 'model_output_invalid', path: [] }];
      decisionFeedback.push(validationFeedback(undefined, issues));
      continue;
    }
    if (input.signal?.aborted) throw Object.assign(new Error('agent_aborted'), { code: 'agent_aborted' });
    if (Date.now() - started > REPORT_SOURCE_DISCOVERY_TIMEOUT_MS) throw new Error('report_source_discovery_deadline');
    const parsed = parseSourceDecision(result.output);
    if (!parsed.ok) {
      if (decisionCorrectionAttempts >= 1) throw invalidModelOutput(parsed.issues);
      decisionCorrectionAttempts += 1;
      decisionFeedback.push(parsed.feedback);
      continue;
    }
    decisionCorrectionAttempts = 0;
    visualEvidenceNeeded = false;
    const decision = parsed.decision;
    if (decision.status === 'planned' && decision.plan) {
      try {
        const plan = await input.validate(decision.plan, evidence, requestSignal);
        for (const item of evidence) seen.add(inspectionKey(item.request));
        assertReportSourceCoverage(plan, input.requirements);
        return plan;
      } catch (error) {
        for (const item of evidence) seen.add(inspectionKey(item.request));
        const code = error instanceof Error ? error.message.split(':', 1)[0] : undefined;
        const correctable = code && ['report_rdb_table_unknown', 'report_http_connection_unknown',
          'report_http_connection_required', 'report_source_binding_unknown',
          'report_source_candidates_added', 'report_source_candidate_not_selected'].includes(code);
        if (!(error instanceof ReportSourceReplanRequired) && !correctable) throw error;
        // New Jev-authorized evidence makes an unchanged plan worth validating again.
        const key = JSON.stringify({ plan: decision.plan,
          evidence: [...new Set(evidence.map(item => inspectionKey(item.request)))].sort() });
        if (rejectedPlans.has(key)) throw new Error('report_source_discovery_no_progress');
        rejectedPlans.add(key);
        if (rejectedPlans.size >= maxPlanRevisions) throw new Error('report_source_discovery_round_limit');
        planFeedback.push(error instanceof ReportSourceReplanRequired
          ? { missingRequirementIds: error.needs.map(need => need.id) }
          : { validationError: code! });
        continue;
      }
    }
    if (decision.status === 'needs_input' || decision.status === 'unsupported') {
      // A clarification before any evidence is a genuine missing-input case.
      // After the host has already collected evidence, allow one bounded
      // reconsideration so a model cannot turn an inspectable source into an
      // unnecessary user prompt simply because its first conclusion was too
      // conservative. Repeated clarification still fails closed.
      if (decision.status === 'needs_input' && evidence.length > 0 && needsInputCorrectionAttempts < 1) {
        needsInputCorrectionAttempts += 1;
        planFeedback.push({ validationError: 'report_source_needs_input_recheck' });
        continue;
      }
      if (decision.status === 'needs_input') throw new ReportSourceClarificationRequired(decision.reason!);
      throw new Error(`report_source_discovery_${decision.status}`);
    }
    const request = decision.request!;
    const key = inspectionKey(request);
    if (seen.has(key)) {
      const previous = evidence.find(item => inspectionKey(item.request) === key);
      if (previous && inspectionSucceeded(previous.result) && !repeatedInspections.has(key)) {
        repeatedInspections.add(key);
        planFeedback.push({ validationError: 'report_source_inspection_already_completed' });
        continue;
      }
      throw new Error('report_source_discovery_no_progress');
    }
    if (inspectionCount >= maxInspections) throw new Error('report_source_discovery_round_limit');
    seen.add(key);
    if (!input.inspect) throw new Error('report_source_discovery_needs_input');
    const inspected = await withinDeadline(() => input.inspect!(request, requestSignal));
    if (JSON.stringify(inspected).length > 24_000) throw new Error('report_source_discovery_evidence_limit');
    evidence.push({ request, result: inspected });
    inspectionCount += 1;
  }
  throw new Error('report_source_discovery_round_limit');
}
