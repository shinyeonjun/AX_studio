import { z } from 'zod';
import { preprocessConditionValue, ConditionExprSchema } from '../../runtime/condition-expr.js';
import {
  InterviewDraftSchema,
  parseBindingsRecord,
  parseJsonRecordValue,
  type InterviewDraft,
  type WorkflowNode,
} from '../draft/schema.js';
import { applySlotValuesToDraft } from '../slots/patch.js';
import { normalizePlanPayload } from './normalize.js';
import { normalizeDraftActions } from '../draft/actions.js';
import { KO } from '../../i18n/ko.js';

const WorkflowPlanNodeSchema = z.object({
  type: z.enum(['action', 'ai_decision', 'if', 'human_approval']),
  id: z.string(),
  connector: z.string().optional(),
  action: z.string().optional(),
  actionRef: z.string().optional(),
  params: z.preprocess(parseJsonRecordValue, z.record(z.unknown()).optional()),
  bindings: z.preprocess(parseBindingsRecord, z.record(z.object({
    from: z.union([z.literal('trigger'), z.string()]),
    output: z.string(),
  })).optional()),
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
  condition: z.preprocess(
    (value) => {
      const parsed = parseJsonRecordValue(value);
      return parsed == null ? undefined : preprocessConditionValue(parsed);
    },
    ConditionExprSchema.optional(),
  ),
  thenStepIds: z.array(z.string()).optional(),
  elseStepIds: z.array(z.string()).optional(),
  reason: z.string().optional(),
  forActionIds: z.array(z.string()).optional(),
});

export const WorkflowPlanSchema = z.preprocess(
  normalizePlanPayload,
  z.object({
  name: z.string().optional(),
  goal: z.string().optional(),
  triggerType: InterviewDraftSchema.shape.triggerType.optional(),
  triggerFilter: InterviewDraftSchema.shape.triggerFilter,
  schedule: z.string().optional(),
  timezone: z.string().optional(),
  runAt: z.string().optional(),
  gmailAccount: z.string().optional(),
  slackChannel: z.string().optional(),
  localFolderId: z.string().optional(),
  localFolderPath: z.string().optional(),
  localFolderExtensions: z.string().optional(),
  success: z.string().optional(),
  assumptions: z.array(z.string()).optional(),
  nodes: z.array(WorkflowPlanNodeSchema).default([]),
  }),
);

export type WorkflowPlan = z.infer<typeof WorkflowPlanSchema>;

function planNodeToWorkflowNode(node: z.infer<typeof WorkflowPlanNodeSchema>): WorkflowNode {
  return node as WorkflowNode;
}

export function planToInterviewDraft(
  plan: WorkflowPlan,
  slotValues: Record<string, unknown>,
  userInstruction: string,
): InterviewDraft {
  const base: InterviewDraft = {
    name: plan.name?.trim() || KO.work.defaultName,
    goal: plan.goal?.trim() || userInstruction,
    triggerType: plan.triggerType,
    triggerFilter: plan.triggerFilter,
    schedule: plan.schedule,
    timezone: plan.timezone,
    runAt: plan.runAt,
    gmailAccount: plan.gmailAccount,
    slackChannel: plan.slackChannel,
    localFolderId: plan.localFolderId,
    localFolderPath: plan.localFolderPath,
    localFolderExtensions: plan.localFolderExtensions,
    success: plan.success,
    assumptions: plan.assumptions ?? [],
    nodes: plan.nodes.map(planNodeToWorkflowNode),
    actions: {},
  };

  return normalizeDraftActions(applySlotValuesToDraft(base, slotValues));
}

export function designFieldsToPlan(record: Record<string, unknown>): WorkflowPlan {
  const { nextQuestion: _nextQuestion, kind: _kind, toolCalls: _toolCalls, ...rest } = record;
  return WorkflowPlanSchema.parse(rest);
}

export function formatPartialPlanForPrompt(plan: WorkflowPlan | undefined): string {
  if (!plan) return '(아직 없음)';
  const lines: string[] = [];
  if (plan.name?.trim()) lines.push(`name: ${plan.name.trim()}`);
  if (plan.goal?.trim()) lines.push(`goal: ${plan.goal.trim()}`);
  if (plan.triggerType) lines.push(`triggerType: ${plan.triggerType}`);
  if (plan.nodes.length === 0) {
    lines.push('nodes: (없음)');
  } else {
    lines.push('nodes:');
    for (const node of plan.nodes) {
      if (node.type === 'action') {
        const action = node.actionRef ?? `${node.connector ?? '?'}.${node.action ?? '?'}`;
        lines.push(`- action ${node.id}: ${action}`);
      } else if (node.type === 'ai_decision') {
        const memo = node.memo?.trim();
        lines.push(`- ai_decision ${node.id}: ${node.goal ?? ''}`.trim());
        if (memo) lines.push(`  memo: ${memo.slice(0, 120)}${memo.length > 120 ? '…' : ''}`);
      } else if (node.type === 'if') {
        lines.push(`- if ${node.id}`);
      } else {
        lines.push(`- human_approval ${node.id}`);
      }
    }
  }
  return lines.join('\n');
}
