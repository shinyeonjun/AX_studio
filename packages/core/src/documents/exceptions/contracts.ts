import { createHash } from 'node:crypto';
import { z } from 'zod';
import { ArtifactCompletenessSchema } from '../../contracts/artifacts/completeness.js';
import { TableColumnTypeSchema } from '../../contracts/artifacts/table.js';

export const EXCEPTION_REVIEW_FLOW_ID = 'excel_policy_exception_review' as const;
export const EXCEPTION_REVIEW_REQUEST_MAX_CHARS = 2_048;
export const EXCEPTION_REVIEW_MAX_ROWS = 500;
const EXCEPTION_REVIEW_MAX_SOURCES = 8;
const EXCEPTION_REVIEW_MAX_COLUMNS = 128;
const EXCEPTION_REVIEW_MAX_POLICY_PAGES = 64;
export const EXCEPTION_REVIEW_MAX_POLICY_CHARS = 128_000;

const ObservedId = z.string().min(1).max(200);
const ContractId = z.string().regex(/^[a-z][a-z0-9_]{0,63}$/u);
const ExceptionReviewDigestSchema = z.string().regex(/^[a-f0-9]{64}$/u);
export const ExceptionReviewCandidateIdSchema = z.string().regex(/^candidate_[a-f0-9]{64}$/u);
const ExceptionReviewRowIdSchema = z.string().regex(/^row_[a-f0-9]{64}$/u);

export function exceptionReviewTextDigest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
      .map(([key, child]) => [key, canonical(child)]));
  }
  return value;
}

export function exceptionReviewDigest(value: unknown): string {
  return exceptionReviewTextDigest(JSON.stringify(canonical(value)));
}

/** Matches source-intake identity; keep physical position independent of business IDs. */
export function exceptionReviewRowIdentity(contentHash: string, sheetName: string, sourceRow: number): string {
  return `row_${exceptionReviewTextDigest(JSON.stringify([contentHash, sheetName, sourceRow]))}`;
}

/** Host-normalized intake metadata. Raw/normalized cell values stay in the source store. */
const ExceptionReviewDatasetSchema = z.object({
  sourceId: ObservedId,
  artifactId: ObservedId,
  tableId: ObservedId,
  label: z.string().trim().min(1).max(200),
  contentHash: ExceptionReviewDigestSchema,
  sheetName: z.string().min(1).max(200),
  headerRow: z.number().int().min(1).max(1_048_576),
  sourceRowCount: z.number().int().min(1),
  completeness: ArtifactCompletenessSchema,
  columns: z.array(z.object({
    name: z.string().min(1).max(200),
    type: TableColumnTypeSchema,
    sourceColumn: z.number().int().min(1).max(16_384),
  }).strict()).min(1).max(EXCEPTION_REVIEW_MAX_COLUMNS),
  rows: z.array(z.object({
    id: ExceptionReviewRowIdSchema,
    sourceRow: z.number().int().min(1).max(1_048_576),
  }).strict()).min(1).max(EXCEPTION_REVIEW_MAX_ROWS),
}).strict();
export type ExceptionReviewDataset = z.infer<typeof ExceptionReviewDatasetSchema>;

/** Every PDF page must be represented; blank pages are explicit, never omitted. */
const ExceptionReviewPolicySchema = z.object({
  sourceId: ObservedId,
  artifactId: ObservedId,
  label: z.string().trim().min(1).max(200),
  contentHash: ExceptionReviewDigestSchema,
  pageCount: z.number().int().min(1).max(EXCEPTION_REVIEW_MAX_POLICY_PAGES),
  completeness: ArtifactCompletenessSchema,
  pages: z.array(z.object({
    index: z.number().int().nonnegative(),
    kind: z.enum(['native_text', 'blank']),
    text: z.string().max(EXCEPTION_REVIEW_MAX_POLICY_CHARS),
    /** True when text alone cannot represent substantive page content. */
    unresolvedVisualContent: z.boolean(),
  }).strict()).min(1).max(EXCEPTION_REVIEW_MAX_POLICY_PAGES),
}).strict();
export type ExceptionReviewPolicy = z.infer<typeof ExceptionReviewPolicySchema>;

export const ExceptionReviewCatalogSchema = z.object({
  schemaVersion: z.literal(1),
  datasets: z.array(ExceptionReviewDatasetSchema).max(EXCEPTION_REVIEW_MAX_SOURCES),
  policies: z.array(ExceptionReviewPolicySchema).max(EXCEPTION_REVIEW_MAX_SOURCES),
}).strict();
export type ExceptionReviewCatalog = z.infer<typeof ExceptionReviewCatalogSchema>;

/** A reviewed host recipe declares roles and categories; Jev cannot create new rules. */
export const ExceptionReviewRecipeSchema = z.object({
  schemaVersion: z.literal(1),
  id: ContractId,
  version: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  roles: z.array(z.object({
    id: ContractId,
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500),
    required: z.boolean(),
    allowedTypes: z.array(TableColumnTypeSchema).min(1).max(TableColumnTypeSchema.options.length),
  }).strict()).min(1).max(16),
  categories: z.array(z.object({
    id: ContractId,
    label: z.string().trim().min(1).max(120),
    description: z.string().trim().min(1).max(500),
  }).strict()).min(1).max(32),
  summaryTemplateId: z.literal('exception_counts_v1'),
}).strict().superRefine((recipe, ctx) => {
  if (new Set(recipe.roles.map(role => role.id)).size !== recipe.roles.length) {
    ctx.addIssue({ code: 'custom', message: 'Role IDs must be unique.', path: ['roles'] });
  }
  if (!recipe.roles.some(role => role.required)) {
    ctx.addIssue({ code: 'custom', message: 'At least one input role must be required.', path: ['roles'] });
  }
  if (new Set(recipe.categories.map(category => category.id)).size !== recipe.categories.length) {
    ctx.addIssue({ code: 'custom', message: 'Category IDs must be unique.', path: ['categories'] });
  }
});
export type ExceptionReviewRecipe = z.infer<typeof ExceptionReviewRecipeSchema>;

const ExceptionReviewPolicyEvidenceSchema = z.object({
  id: z.string().regex(/^evidence_[a-f0-9]{64}$/u),
  pageIndex: z.number().int().nonnegative(),
  start: z.literal(0),
  /** Offsets use JavaScript UTF-16 string indices on the original extracted page text. */
  end: z.number().int().positive().max(EXCEPTION_REVIEW_MAX_POLICY_CHARS),
  textDigest: ExceptionReviewDigestSchema,
}).strict();

/** Logical recipe tasks, not connector capability IDs or executable AX commands. */
export const EXCEPTION_REVIEW_TASKS = [
  { id: 'intake', operationId: 'exception_review.verify_intake', dependsOn: [] },
  { id: 'map_columns', operationId: 'exception_review.map_columns', dependsOn: ['intake'] },
  { id: 'assess_rows', operationId: 'exception_review.assess_rows', dependsOn: ['map_columns'] },
  { id: 'review', operationId: 'exception_review.human_review', dependsOn: ['assess_rows'] },
  { id: 'aggregate', operationId: 'exception_review.aggregate', dependsOn: ['review'] },
  { id: 'report', operationId: 'exception_review.render_report', dependsOn: ['aggregate'] },
] as const;

export const ExceptionReviewTaskPlanSchema = z.object({
  schemaVersion: z.literal(1),
  flowId: z.literal(EXCEPTION_REVIEW_FLOW_ID),
  flowVersion: z.literal(1),
  request: z.string().min(1).max(EXCEPTION_REVIEW_REQUEST_MAX_CHARS),
  requestDigest: ExceptionReviewDigestSchema,
  recipeId: ContractId,
  recipeVersion: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  recipeDigest: ExceptionReviewDigestSchema,
  sourceCatalogDigest: ExceptionReviewDigestSchema,
  planDigest: ExceptionReviewDigestSchema,
  dataset: ExceptionReviewDatasetSchema,
  columnBindings: z.array(z.object({
    roleId: ContractId,
    columnName: z.string().min(1).max(200),
    sourceColumn: z.number().int().min(1).max(16_384),
    type: TableColumnTypeSchema,
  }).strict()).min(1).max(16),
  policy: z.object({
    sourceId: ObservedId,
    artifactId: ObservedId,
    contentHash: ExceptionReviewDigestSchema,
    pageCount: z.number().int().min(1).max(EXCEPTION_REVIEW_MAX_POLICY_PAGES),
    evidence: z.array(ExceptionReviewPolicyEvidenceSchema).min(1).max(EXCEPTION_REVIEW_MAX_POLICY_PAGES),
    blankPageIndices: z.array(z.number().int().nonnegative()).max(EXCEPTION_REVIEW_MAX_POLICY_PAGES),
  }).strict(),
  categories: ExceptionReviewRecipeSchema.innerType().shape.categories,
  summaryTemplateId: z.literal('exception_counts_v1'),
  reviewRequired: z.literal(true),
  tasks: z.array(z.object({
    id: z.enum(['intake', 'map_columns', 'assess_rows', 'review', 'aggregate', 'report']),
    operationId: z.enum(EXCEPTION_REVIEW_TASKS.map(task => task.operationId) as [
      typeof EXCEPTION_REVIEW_TASKS[number]['operationId'], ...Array<typeof EXCEPTION_REVIEW_TASKS[number]['operationId']>,
    ]),
    dependsOn: z.array(z.string()),
  }).strict()).length(EXCEPTION_REVIEW_TASKS.length),
}).strict().superRefine((plan, ctx) => {
  const issue = (message: string, path: Array<string | number>) => ctx.addIssue({ code: 'custom', message, path });
  const { planDigest, ...value } = plan;
  if (!plan.request.trim() || plan.requestDigest !== exceptionReviewTextDigest(plan.request)) {
    issue('The complete current request must match its digest.', ['requestDigest']);
  }
  if (planDigest !== exceptionReviewDigest(value)) issue('Plan contents do not match the digest.', ['planDigest']);
  for (const [index, task] of plan.tasks.entries()) {
    const expected = EXCEPTION_REVIEW_TASKS[index]!;
    if (task.id !== expected.id || task.operationId !== expected.operationId
      || JSON.stringify(task.dependsOn) !== JSON.stringify(expected.dependsOn)) {
      issue('Only the declared review-first task graph is permitted.', ['tasks', index]);
    }
  }
  if (plan.dataset.completeness.status !== 'complete' || plan.dataset.completeness.hasMore === true
    || plan.dataset.completeness.reason !== undefined
    || plan.dataset.sourceRowCount > EXCEPTION_REVIEW_MAX_ROWS
    || plan.dataset.rows.length !== plan.dataset.sourceRowCount
    || plan.dataset.completeness.observedCount !== plan.dataset.sourceRowCount) {
    issue('A plan requires every row in its selected source scope.', ['dataset']);
  }
  if (new Set(plan.dataset.rows.map(row => row.id)).size !== plan.dataset.rows.length
    || new Set(plan.dataset.rows.map(row => row.sourceRow)).size !== plan.dataset.rows.length
    || plan.dataset.rows.some(row => row.sourceRow <= plan.dataset.headerRow
      || row.id !== exceptionReviewRowIdentity(plan.dataset.contentHash, plan.dataset.sheetName, row.sourceRow))) {
    issue('Row provenance must match source bytes, sheet and physical row.', ['dataset', 'rows']);
  }
  if (new Set(plan.columnBindings.map(binding => binding.roleId)).size !== plan.columnBindings.length
    || new Set(plan.columnBindings.map(binding => binding.sourceColumn)).size !== plan.columnBindings.length
    || plan.columnBindings.some(binding => !plan.dataset.columns.some(column => column.name === binding.columnName
      && column.sourceColumn === binding.sourceColumn && column.type === binding.type))) {
    issue('Column bindings must be distinct observed columns.', ['columnBindings']);
  }
  if (new Set(plan.dataset.columns.map(column => column.name)).size !== plan.dataset.columns.length
    || new Set(plan.dataset.columns.map(column => column.sourceColumn)).size !== plan.dataset.columns.length) {
    issue('Source column identities must be unique.', ['dataset', 'columns']);
  }
  if (new Set(plan.categories.map(category => category.id)).size !== plan.categories.length) {
    issue('Category IDs must be unique.', ['categories']);
  }
  if (new Set(plan.policy.evidence.map(evidence => evidence.id)).size !== plan.policy.evidence.length
    || new Set(plan.policy.evidence.map(evidence => evidence.pageIndex)).size !== plan.policy.evidence.length
    || plan.policy.evidence.some(evidence => evidence.pageIndex >= plan.policy.pageCount
      || evidence.id !== `evidence_${exceptionReviewDigest({ document: plan.policy.contentHash,
        pageIndex: evidence.pageIndex, textDigest: evidence.textDigest })}`)) {
    issue('Evidence must retain distinct observed page identities.', ['policy', 'evidence']);
  }
  const representedPages = [...plan.policy.evidence.map(evidence => evidence.pageIndex), ...plan.policy.blankPageIndices]
    .sort((left, right) => left - right);
  if (representedPages.length !== plan.policy.pageCount || representedPages.some((page, index) => page !== index)
    || plan.policy.evidence.reduce((sum, evidence) => sum + evidence.end, 0) > EXCEPTION_REVIEW_MAX_POLICY_CHARS) {
    issue('Every policy page must be represented within the text budget.', ['policy']);
  }
});
export type ExceptionReviewTaskPlan = z.infer<typeof ExceptionReviewTaskPlanSchema>;

export type ExceptionReviewClarificationReason =
  | 'invalid_request' | 'request_too_long' | 'invalid_catalog' | 'invalid_recipe'
  | 'missing_dataset' | 'missing_policy' | 'incomplete_dataset' | 'dataset_limit'
  | 'invalid_provenance' | 'incomplete_policy' | 'policy_text_required'
  | 'policy_visual_content' | 'policy_text_limit' | 'unsupported_request'
  | 'ambiguous_source' | 'ambiguous_columns' | 'invalid_answer'
  | 'requirements_unmet' | 'scope_mismatch' | 'decision_unavailable' | 'cancelled';

export interface ExceptionReviewPlanTelemetry {
  evaluationCalls: number;
  providerRequestCount?: number;
}

export type ExceptionReviewPlanResult =
  | { kind: 'plan'; plan: ExceptionReviewTaskPlan; telemetry: ExceptionReviewPlanTelemetry }
  | { kind: 'clarify'; reason: ExceptionReviewClarificationReason; telemetry: ExceptionReviewPlanTelemetry };
