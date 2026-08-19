import { randomUUID } from 'node:crypto';
import type { WorkflowIR, Step } from '../workflow/schema.js';
import { assessCompleteness } from './requiredness.js';
import type { InterviewState } from './interview-state.js';
import type { InterviewDraft, WorkflowNode } from './workflow-schema.js';

function workflowNodeFromStep(step: Step): WorkflowNode | null {
  switch (step.type) {
    case 'action':
      return {
        type: 'action',
        id: step.id,
        connector: step.connector,
        action: step.action,
        params: Object.fromEntries(
          Object.entries(step.params).map(([key, value]) => [key, String(value)]),
        ),
      };
    case 'human_approval':
      return {
        type: 'human_approval',
        id: step.id,
        reason: step.reason,
        forActionIds: step.forActionIds,
      };
    case 'ai_decision':
      return {
        type: 'ai_decision',
        id: step.id,
        goal: step.goal,
        investigation: step.investigation,
      };
    case 'if':
      return {
        type: 'if',
        id: step.id,
        condition: step.condition,
        thenStepIds: step.thenStepIds,
        elseStepIds: step.elseStepIds,
      };
    default:
      return null;
  }
}

function triggerFields(
  ir: WorkflowIR,
): Pick<
  InterviewDraft,
  | 'triggerType'
  | 'schedule'
  | 'runAt'
  | 'gmailAccount'
  | 'slackChannel'
  | 'localFolderId'
  | 'localFolderExtensions'
  | 'timezone'
> {
  const trigger = ir.trigger;
  if (trigger?.type === 'schedule') {
    return {
      triggerType: 'schedule',
      schedule: trigger.schedule,
      timezone: trigger.timezone,
    };
  }
  if (trigger?.type === 'once') {
    return { triggerType: 'once', runAt: trigger.runAt };
  }
  if (trigger?.type === 'gmail.new_message') {
    return { triggerType: 'gmail.new_message', gmailAccount: trigger.accountId };
  }
  if (trigger?.type === 'slack.new_message') {
    return { triggerType: 'slack.new_message', slackChannel: trigger.channel };
  }
  if (trigger?.type === 'local_folder.new_file') {
    return {
      triggerType: 'local_folder.new_file',
      localFolderId: trigger.folderId,
      localFolderExtensions: trigger.extensions?.join(','),
    };
  }
  return { triggerType: 'manual' };
}

export function bootstrapInterviewFromWorkflow(ir: WorkflowIR, workflowId: string): InterviewState {
  const workflow: InterviewDraft = {
    name: ir.name,
    goal: ir.goal ?? ir.name,
    assumptions: ir.assumptions ?? [],
    nodes: (ir.steps ?? []).flatMap((step) => {
      const node = workflowNodeFromStep(step);
      return node ? [node] : [];
    }),
    ...triggerFields(ir),
  };

  return {
    sessionId: randomUUID(),
    userInstruction: ir.goal ?? ir.name,
    draft: ir,
    workflow,
    completeness: assessCompleteness(ir),
    done: true,
    messages: [
      {
        role: 'assistant',
        content: `「${ir.name}」 업무입니다. 수정하거나 추가 지시를 계속 말씀해주세요.`,
      },
    ],
    workflowId,
  };
}
