import { z } from 'zod';

export const WorkflowNodeSchema = z.object({
  type: z.enum(['action', 'ai_decision', 'if', 'human_approval']),
  id: z.string(),
  connector: z.string().optional(),
  action: z.string().optional(),
  params: z.record(z.string()).optional(),
  goal: z.string().optional(),
  outputFields: z
    .array(
      z.object({
        name: z.string(),
        type: z.enum(['string', 'number', 'boolean']),
        description: z.string(),
      }),
    )
    .optional(),
  investigation: z.boolean().optional(),
  condition: z.string().optional(),
  thenStepIds: z.array(z.string()).optional(),
  elseStepIds: z.array(z.string()).optional(),
  reason: z.string().optional(),
  forActionIds: z.array(z.string()).optional(),
});

export const InterviewDraftSchema = z.object({
  name: z.string(),
  goal: z.string(),
  triggerType: z.enum(['manual', 'schedule', 'once', 'gmail.new_message']),
  schedule: z.string().optional(),
  timezone: z.string().optional(),
  runAt: z.string().optional(),
  gmailAccount: z.string().optional(),
  success: z.string().optional(),
  assumptions: z.array(z.string()).default([]),
  nodes: z.array(WorkflowNodeSchema).default([]),
});

export const InterviewTurnSchema = InterviewDraftSchema.extend({
  nextQuestion: z.string(),
});

export type WorkflowNode = z.infer<typeof WorkflowNodeSchema>;
export type InterviewDraft = z.infer<typeof InterviewDraftSchema>;
export type InterviewTurn = z.infer<typeof InterviewTurnSchema>;
