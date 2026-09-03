import { createHash } from 'node:crypto';
import {
  RepairCandidateOperationSchema,
  type RepairCandidateOperation,
  type RepairReplaySummary,
} from './contract.js';
import type { WorkflowIR } from '../schema.js';

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
