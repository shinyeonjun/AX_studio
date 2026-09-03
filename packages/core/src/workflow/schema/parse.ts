import { actionRefFor } from '../action-definition.js';
import { MAX_WORKFLOW_SERIALIZED_CHARS } from './limits.js';
import { WorkflowIRSchema } from './workflow.js';
import type { WorkflowIR } from './workflow.js';

function workflowSizeError(data: unknown): string | undefined {
  let serialized: string;
  try {
    serialized = JSON.stringify(data) ?? '';
  } catch {
    return 'workflow payload를 직렬화할 수 없습니다.';
  }
  if (serialized.length > MAX_WORKFLOW_SERIALIZED_CHARS) {
    return `workflow payload가 너무 큽니다. ${MAX_WORKFLOW_SERIALIZED_CHARS.toLocaleString()}자 이내여야 합니다.`;
  }
  return undefined;
}

export function parseWorkflowIR(data: unknown): WorkflowIR {
  const sizeError = workflowSizeError(data);
  if (sizeError) throw new Error(sizeError);
  const parsed = WorkflowIRSchema.parse(data);
  return {
    ...parsed,
    steps: parsed.steps.map((step) =>
      step.type === 'action'
        ? { ...step, actionRef: step.actionRef ?? actionRefFor(step.connector, step.action) }
        : step,
    ),
  };
}

export function validateWorkflowIR(data: unknown): { ok: true; value: WorkflowIR } | { ok: false; error: string } {
  const sizeError = workflowSizeError(data);
  if (sizeError) return { ok: false, error: sizeError };
  const result = WorkflowIRSchema.safeParse(data);
  if (!result.success) {
    return { ok: false, error: result.error.message };
  }
  return { ok: true, value: result.data };
}
