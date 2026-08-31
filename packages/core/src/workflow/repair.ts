import { createHash } from 'node:crypto';
import { z } from 'zod';
import type {
  InputContract,
  InputContractColumnType,
  OutputContract,
} from '../contracts/output-contract.js';
import {
  describeInputColumns,
  inputColumnTypesCompatible,
} from '../runtime/output-contract.js';
import type { ConditionExpr, ConditionValue } from '../runtime/condition-expr.js';
import type { Step, WorkflowIR } from './schema.js';
import { TransformExprSchema, type TransformExpr } from './transform-expr/dsl.js';

const RepairColumnNameSchema = z.string().trim().min(1).max(200);

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

function normalizedName(value: string): string {
  return value
    .normalize('NFKC')
    .toLocaleLowerCase('en-US')
    .replace(/[^a-z0-9가-힣]+/gu, ' ')
    .trim();
}

function stemToken(value: string): string {
  if (value.length > 4 && value.endsWith('s') && !/(ss|us|is)$/u.test(value)) {
    return value.slice(0, -1);
  }
  return value;
}

function nameTokens(value: string): string[] {
  return [...new Set(normalizedName(value).split(/\s+/u).filter(Boolean).map(stemToken))];
}

function columnNameSimilarity(expected: string, actual: string): number {
  const expectedTokens = nameTokens(expected);
  const actualTokens = nameTokens(actual);
  if (expectedTokens.length === 0 || actualTokens.length === 0) return 0;
  const actualSet = new Set(actualTokens);
  const overlap = expectedTokens.filter((token) => actualSet.has(token)).length;
  if (overlap === 0) return 0;
  const tokenScore = overlap / Math.max(expectedTokens.length, actualTokens.length);
  const firstTokenBonus = expectedTokens[0] === actualTokens[0] ? 0.15 : 0;
  return Math.min(1, tokenScore + firstTokenBonus);
}

function compatibleExpectedType(type: string): type is InputContractColumnType {
  return [
    'string',
    'number',
    'integer',
    'boolean',
    'date',
    'datetime',
    'currency',
    'percentage',
    'unknown',
  ].includes(type);
}

function candidateId(
  sourceId: string,
  stepId: string,
  from: string,
  to: string,
): string {
  return `repair_${createHash('sha256')
    .update(`${sourceId}\0${stepId}\0${from}\0${to}`)
    .digest('hex')
    .slice(0, 20)}`;
}

/**
 * Suggests only source-column rename candidates. It reads the input schema,
 * but never copies a row or cell value into a candidate.
 */
export function suggestRepairCandidates(
  contract: OutputContract,
  stepId: string,
  data: unknown,
): RepairCandidateOperation[] {
  const schemas = contract.inputSchemas.filter((entry) => entry.stepId === stepId);
  const actualColumns = describeInputColumns(data);
  if (schemas.length === 0 || !actualColumns) return [];

  const actualByName = new Map(actualColumns.map((column) => [column.name, column]));
  const candidates: Array<RepairCandidateOperation & { score: number }> = [];
  for (const schema of schemas) {
    for (const expected of schema.columns) {
      if (actualByName.has(expected.name)) continue;
      if (!compatibleExpectedType(expected.type) || expected.type === 'unknown') continue;

      const matches = actualColumns
        .filter((actual) => inputColumnTypesCompatible(expected.type, actual.type))
        .map((actual) => ({ actual, score: columnNameSimilarity(expected.name, actual.name) }))
        .filter((entry) => entry.score >= 0.45)
        .sort((left, right) => right.score - left.score || left.actual.name.localeCompare(right.actual.name));
      const best = matches[0];
      if (!best) continue;
      candidates.push({
        id: candidateId(schema.sourceId, schema.stepId, expected.name, best.actual.name),
        op: 'rename_column',
        sourceId: schema.sourceId,
        stepId: schema.stepId,
        from: expected.name,
        to: best.actual.name,
        expectedType: expected.type,
        actualType: best.actual.type,
        confidence: best.score,
        score: best.score,
      });
    }
  }

  const targetCounts = new Map<string, number>();
  for (const candidate of candidates) {
    const key = `${candidate.sourceId}\0${candidate.stepId}\0${candidate.to}`;
    targetCounts.set(key, (targetCounts.get(key) ?? 0) + 1);
  }

  return candidates
    .filter((candidate) => targetCounts.get(`${candidate.sourceId}\0${candidate.stepId}\0${candidate.to}`) === 1)
    .sort((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, 20)
    .map(({ score: _score, ...candidate }) => candidate);
}

function sourceIdsInExpr(expr: TransformExpr): Set<string> {
  if (expr.op === 'source') return new Set([expr.sourceId]);
  if (expr.op === 'ratio') {
    return new Set([
      ...sourceIdsInExpr(expr.numerator),
      ...sourceIdsInExpr(expr.denominator),
    ]);
  }
  return sourceIdsInExpr(expr.input);
}

function renameConditionValue(value: ConditionValue, from: string, to: string): ConditionValue {
  return 'ref' in value && value.ref === from ? { ...value, ref: to } : value;
}

function renameCondition(condition: ConditionExpr, from: string, to: string): ConditionExpr {
  switch (condition.op) {
    case 'and':
    case 'or':
      return { ...condition, args: condition.args.map((entry) => renameCondition(entry, from, to)) };
    case 'not':
      return { ...condition, arg: renameCondition(condition.arg, from, to) };
    default:
      return {
        ...condition,
        left: renameConditionValue(condition.left, from, to),
        right: renameConditionValue(condition.right, from, to),
      };
  }
}

function renameExpr(
  expr: TransformExpr,
  candidate: RepairCandidateOperation,
): { expr: TransformExpr; changed: boolean } {
  const inScope = sourceIdsInExpr(expr).has(candidate.sourceId);
  const rename = (value: string): { value: string; changed: boolean } =>
    inScope && value === candidate.from
      ? { value: candidate.to, changed: true }
      : { value, changed: false };

  switch (expr.op) {
    case 'source':
      return { expr, changed: false };
    case 'column': {
      const input = renameExpr(expr.input, candidate);
      const name = rename(expr.name);
      return { expr: { ...expr, input: input.expr, name: name.value }, changed: input.changed || name.changed };
    }
    case 'filter': {
      const input = renameExpr(expr.input, candidate);
      const where = inScope ? renameCondition(expr.where, candidate.from, candidate.to) : expr.where;
      return {
        expr: { ...expr, input: input.expr, where },
        changed: input.changed || (inScope && JSON.stringify(where) !== JSON.stringify(expr.where)),
      };
    }
    case 'aggregate': {
      const input = renameExpr(expr.input, candidate);
      const column = expr.column === undefined ? undefined : rename(expr.column).value;
      return {
        expr: { ...expr, input: input.expr, ...(column === undefined ? {} : { column }) },
        changed: input.changed || (inScope && expr.column === candidate.from),
      };
    }
    case 'ratio': {
      const numerator = renameExpr(expr.numerator, candidate);
      const denominator = renameExpr(expr.denominator, candidate);
      return {
        expr: { ...expr, numerator: numerator.expr, denominator: denominator.expr },
        changed: numerator.changed || denominator.changed,
      };
    }
    case 'lookup': {
      const input = renameExpr(expr.input, candidate);
      const keyColumn = rename(expr.keyColumn);
      const valueColumn = rename(expr.valueColumn);
      return {
        expr: { ...expr, input: input.expr, keyColumn: keyColumn.value, valueColumn: valueColumn.value },
        changed: input.changed || keyColumn.changed || valueColumn.changed,
      };
    }
    case 'select': {
      const input = renameExpr(expr.input, candidate);
      const columns = expr.columns.map((column) => rename(column).value);
      return { expr: { ...expr, input: input.expr, columns }, changed: input.changed || columns.some((column, index) => column !== expr.columns[index]) };
    }
    case 'sort': {
      const input = renameExpr(expr.input, candidate);
      const by = expr.by.map((entry) => ({ ...entry, column: rename(entry.column).value }));
      return { expr: { ...expr, input: input.expr, by }, changed: input.changed || by.some((entry, index) => entry.column !== expr.by[index]?.column) };
    }
    case 'limit': {
      const input = renameExpr(expr.input, candidate);
      return { expr: { ...expr, input: input.expr }, changed: input.changed };
    }
  }
}

function rewriteDocument(document: string | undefined, candidate: RepairCandidateOperation): { document?: string; changed: boolean } {
  if (!document) return { changed: false };
  let raw: unknown;
  try {
    raw = JSON.parse(document);
  } catch {
    return { document, changed: false };
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return { document, changed: false };
  const record = raw as Record<string, unknown>;
  if (!Array.isArray(record.fields)) return { document, changed: false };
  let changed = false;
  const fields = record.fields.map((field) => {
    if (!field || typeof field !== 'object' || Array.isArray(field)) return field;
    const fieldRecord = field as Record<string, unknown>;
    const parsed = TransformExprSchema.safeParse(fieldRecord.mapping);
    if (!parsed.success) return field;
    const rewritten = renameExpr(parsed.data, candidate);
    if (!rewritten.changed) return field;
    changed = true;
    return { ...fieldRecord, mapping: rewritten.expr };
  });
  return changed ? { document: JSON.stringify({ ...record, fields }), changed: true } : { document, changed: false };
}

function rewriteActionStep(step: Extract<Step, { type: 'action' }>, candidate: RepairCandidateOperation): { step: Step; changed: boolean } {
  if (step.connector !== 'transform' || step.action !== 'evaluate') return { step, changed: false };
  const parsed = TransformExprSchema.safeParse(step.params.expr);
  if (!parsed.success) return { step, changed: false };
  const rewritten = renameExpr(parsed.data, candidate);
  if (!rewritten.changed) return { step, changed: false };
  return {
    step: {
      ...step,
      params: { ...step.params, expr: rewritten.expr },
    },
    changed: true,
  };
}

function rewriteInputSchema(contract: OutputContract, candidate: RepairCandidateOperation): OutputContract {
  return {
    ...contract,
    inputSchemas: contract.inputSchemas.map((schema) => {
      if (schema.sourceId !== candidate.sourceId || schema.stepId !== candidate.stepId) return schema;
      return {
        ...schema,
        columns: schema.columns.map((column) =>
          column.name === candidate.from ? { ...column, name: candidate.to } : column),
      };
    }),
  };
}

/** Applies one explicitly selected rename candidate; it never changes policy fields. */
export function applyRepairCandidate(workflow: WorkflowIR, candidate: RepairCandidateOperation): WorkflowIR {
  const parsedCandidate = RepairCandidateOperationSchema.parse(candidate);
  const inputSchema = workflow.outputContract?.inputSchemas.find((entry) =>
    entry.sourceId === parsedCandidate.sourceId && entry.stepId === parsedCandidate.stepId,
  );
  if (!inputSchema || !inputSchema.columns.some((column) => column.name === parsedCandidate.from)) {
    throw new Error('repair_candidate_not_applicable');
  }
  if (inputSchema.columns.some((column) => column.name === parsedCandidate.to)) {
    throw new Error('repair_target_column_already_exists');
  }

  let changed = false;
  const steps = workflow.steps.map((step) => {
    if (step.type !== 'action') return step;
    const rewritten = rewriteActionStep(step, parsedCandidate);
    changed ||= rewritten.changed;
    return rewritten.step;
  });
  if (!changed) throw new Error('repair_candidate_not_applicable');

  const document = rewriteDocument(workflow.document, parsedCandidate);
  return {
    ...workflow,
    steps,
    outputContract: workflow.outputContract
      ? rewriteInputSchema(workflow.outputContract, parsedCandidate)
      : undefined,
    ...(document.document === undefined ? {} : { document: document.document }),
  };
}

function protectedDocument(document: string | undefined): unknown {
  if (!document) return undefined;
  try {
    const parsed = JSON.parse(document) as Record<string, unknown>;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return document;
    const fields = Array.isArray(parsed.fields)
      ? parsed.fields.map((field) => {
        if (!field || typeof field !== 'object' || Array.isArray(field)) return field;
        const record = field as Record<string, unknown>;
        return { ...record, ...(Object.hasOwn(record, 'mapping') ? { mapping: '__repairable_mapping__' } : {}) };
      })
      : parsed.fields;
    return { ...parsed, ...(Array.isArray(parsed.fields) ? { fields } : {}) };
  } catch {
    return document;
  }
}

/**
 * Stable safety fingerprint used by tests and callers to prove that a repair
 * did not mutate workflow policy, trigger, side effects, or action payloads.
 */
export function repairProtectedFingerprint(workflow: WorkflowIR, candidate: RepairCandidateOperation): string {
  const steps = workflow.steps.map((step) => {
    if (step.type !== 'action') return step;
    const params = step.connector === 'transform' && step.action === 'evaluate'
      ? Object.fromEntries(Object.entries(step.params).filter(([key]) => key !== 'expr'))
      : step.params;
    return { ...step, params };
  });
  const inputSchemas = workflow.outputContract?.inputSchemas.map((schema) => ({
    ...schema,
    columns: schema.columns.map((column) =>
      schema.sourceId === candidate.sourceId && schema.stepId === candidate.stepId &&
        (column.name === candidate.from || column.name === candidate.to)
        ? { ...column, name: '__repairable_column__' }
        : column),
  }));
  return JSON.stringify({
    ...workflow,
    version: 0,
    steps,
    outputContract: workflow.outputContract
      ? { ...workflow.outputContract, inputSchemas }
      : undefined,
    document: protectedDocument(workflow.document),
  });
}

export function repairDedupeKey(
  workflowId: string,
  baseVersion: number,
  candidates: RepairCandidateOperation[],
): string {
  const normalized = candidates.map((candidate) => RepairCandidateOperationSchema.parse(candidate));
  return `repair_v1_${createHash('sha256')
    .update(JSON.stringify({ workflowId, baseVersion, candidates: normalized }))
    .digest('hex')}`;
}

export function emptyRepairReplaySummary(): RepairReplaySummary {
  return { status: 'not_run', total: 0, passed: 0, failed: 0, cases: [] };
}
