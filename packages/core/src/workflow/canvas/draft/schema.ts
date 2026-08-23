import { z } from 'zod';
import { ConditionExprSchema, preprocessConditionValue } from '../../../runtime/condition-expr.js';
import { PortBindingSchema, coercePortBinding } from '../../../workflow/port-binding.js';
import { ActionInstanceSchema, type ActionInstance } from '../../../workflow/action-instance.js';
import { MAX_WORKFLOW_STEPS } from '../../../workflow/schema.js';
export { ActionInstanceSchema, type ActionInstance } from '../../../workflow/action-instance.js';

export function parseJsonRecordValue(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  if (!value.trim()) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : value;
  } catch {
    return value;
  }
}

export function parseBindingsRecord(value: unknown): unknown {
  if (value == null || value === '') return undefined;
  const parsed = parseJsonRecordValue(value);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return parsed;

  const normalized: Record<string, unknown> = {};
  for (const [port, binding] of Object.entries(parsed as Record<string, unknown>)) {
    const coerced = coercePortBinding(binding);
    if (coerced) normalized[port] = coerced;
  }
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

export const WorkflowNodeSchema = z.object({
  type: z.enum(['action', 'ai_decision', 'if', 'human_approval']),
  id: z.string(),
  connector: z.string().optional(),
  action: z.string().optional(),
  actionRef: z.string().optional(),
  params: z.preprocess(parseJsonRecordValue, z.record(z.unknown()).optional()),
  bindings: z.preprocess(parseBindingsRecord, z.record(PortBindingSchema).optional()),
  goal: z.string().optional(),
  memo: z.string().optional(),
  outputFields: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(['string', 'number', 'boolean', 'array']),
        description: z.string(),
        enumValues: z.array(z.string()).optional(),
      }),
    )
    .optional(),
  investigation: z.boolean().optional(),
  condition: z.preprocess((value) => preprocessConditionValue(value), ConditionExprSchema.optional()),
  thenStepIds: z.array(z.string()).optional(),
  elseStepIds: z.array(z.string()).optional(),
  reason: z.string().optional(),
  forActionIds: z.array(z.string()).optional(),
});

export const WorkflowCanvasDraftSchema = z.object({
  name: z.string(),
  goal: z.string(),
  triggerType: z
    .enum(['manual', 'schedule', 'once', 'gmail.new_message', 'slack.new_message', 'local_folder.new_file'])
    .optional(),
  triggerFilter: z.preprocess((value) => preprocessConditionValue(value), ConditionExprSchema.optional()),
  schedule: z.string().optional(),
  timezone: z.string().optional(),
  runAt: z.string().optional(),
  gmailAccount: z.string().optional(),
  slackChannel: z.string().optional(),
  localFolderId: z.string().optional(),
  localFolderPath: z.string().optional(),
  localFolderExtensions: z.string().optional(),
  success: z.string().optional(),
  assumptions: z.array(z.string()).default([]),
  nodes: z.array(WorkflowNodeSchema).max(MAX_WORKFLOW_STEPS).default([]),
  actions: z.record(ActionInstanceSchema).default({}),
});

export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export type WorkflowCanvasDraftInput = z.input<typeof WorkflowCanvasDraftSchema>;
export type WorkflowCanvasDraft = z.infer<typeof WorkflowCanvasDraftSchema>;
