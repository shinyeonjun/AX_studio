import type { ChatMessage } from '../agent/model/chat.js';
import type { CompletenessResult } from '../interview/slots/types.js';
import { assessCompleteness } from '../interview/slots/requiredness.js';
import { actionRefFor } from './action-definition.js';
import type { WorkflowIR, Step } from './schema.js';
import { InterviewDraftSchema, type ActionInstance, type InterviewDraft, type WorkflowNode } from '../interview/draft/schema.js';
import type { WorkspaceExecutionMode } from '../workspace/commands.js';

export interface WorkflowViewState {
  workflowId: string;
  userInstruction: string;
  draft: Partial<WorkflowIR>;
  workflow: InterviewDraft;
  executionMode: WorkspaceExecutionMode;
  completeness: CompletenessResult;
  done: true;
  messages: ChatMessage[];
}

function nodeFromStep(step: Step): { node: WorkflowNode; action?: ActionInstance } | null {
  if (step.type === 'action') {
    const ref = step.actionRef ?? actionRefFor(step.connector, step.action);
    return {
      node: { type: 'action', id: step.id, actionRef: ref },
      action: {
        actionRef: ref,
        connector: step.connector,
        action: step.action,
        params: Object.fromEntries(Object.entries(step.params).map(([key, value]) => [key, String(value)])),
        bindings: step.bindings,
      },
    };
  }
  if (step.type === 'human_approval') {
    return { node: { type: 'human_approval', id: step.id, reason: step.reason, forActionIds: step.forActionIds } };
  }
  if (step.type === 'ai_decision') {
    return {
      node: {
        type: 'ai_decision',
        id: step.id,
        goal: step.goal,
        memo: step.memo,
        investigation: step.investigation,
        outputFields: step.outputSchema
          ? Object.entries((step.outputSchema.properties ?? {}) as Record<string, Record<string, unknown>>).map(
              ([name, definition]) => ({
                name,
                type: (definition.type === 'number' ? 'number' : definition.type === 'boolean' ? 'boolean' : 'string') as
                  | 'string'
                  | 'number'
                  | 'boolean',
                description: typeof definition.description === 'string' ? definition.description : name,
                enumValues: Array.isArray(definition.enum) ? definition.enum.map(String) : undefined,
              }),
            )
          : undefined,
      },
    };
  }
  if (step.type === 'if') {
    return {
      node: {
        type: 'if',
        id: step.id,
        condition: step.condition,
        thenStepIds: step.thenStepIds,
        elseStepIds: step.elseStepIds,
      },
    };
  }
  return null;
}

function triggerFields(ir: WorkflowIR): Partial<InterviewDraft> {
  const trigger = ir.trigger;
  if (!trigger) return {};
  if (trigger.type === 'schedule') return { triggerType: 'schedule', schedule: trigger.schedule, timezone: trigger.timezone };
  if (trigger.type === 'once') return { triggerType: 'once', runAt: trigger.runAt, triggerFilter: trigger.filter };
  if (trigger.type === 'manual') return { triggerType: 'manual', triggerFilter: trigger.filter };
  if (trigger.type === 'gmail.new_message') {
    return { triggerType: 'gmail.new_message', gmailAccount: trigger.accountId, triggerFilter: trigger.filter };
  }
  if (trigger.type === 'slack.new_message') {
    return { triggerType: 'slack.new_message', slackChannel: trigger.channel, triggerFilter: trigger.filter };
  }
  if (trigger.type === 'local_folder.new_file') {
    return {
      triggerType: 'local_folder.new_file',
      localFolderId: trigger.folderId,
      localFolderPath: trigger.folderPath,
      localFolderExtensions: trigger.extensions?.join(','),
      triggerFilter: trigger.filter,
    };
  }
  return {};
}

function executionModeForTrigger(ir: WorkflowIR): WorkspaceExecutionMode {
  const type = ir.trigger?.type;
  return type === 'schedule' || type === 'gmail.new_message' || type === 'slack.new_message' || type === 'local_folder.new_file'
    ? 'workflow'
    : 'once';
}

export function buildWorkflowView(ir: WorkflowIR, workflowId: string): WorkflowViewState {
  const actions: InterviewDraft['actions'] = {};
  const nodes: WorkflowNode[] = [];
  for (const step of ir.steps) {
    const mapped = nodeFromStep(step);
    if (!mapped) continue;
    nodes.push(mapped.node);
    if (mapped.action) actions[mapped.node.id] = mapped.action;
  }

  const workflow = InterviewDraftSchema.parse({
    name: ir.name,
    goal: ir.goal,
    assumptions: ir.assumptions,
    nodes,
    actions,
    ...triggerFields(ir),
  });

  const assistantMessage: ChatMessage = {
    role: 'assistant',
    content: `「${ir.name}」 업무입니다. 이 대화에서 수정하거나 추가 지시를 계속 말씀해주세요.`,
  };
  return {
    workflowId,
    userInstruction: ir.goal,
    draft: ir,
    workflow,
    executionMode: executionModeForTrigger(ir),
    completeness: assessCompleteness(ir),
    done: true,
    messages: [assistantMessage],
  };
}
