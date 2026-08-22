import { randomUUID } from 'node:crypto';
import type { WorkflowIR, Step } from '../../workflow/schema.js';
import { assessCompleteness } from '../slots/requiredness.js';
import type { InterviewState } from '../session/state.js';
import { resolveWorkScope } from '../session/work-scope.js';
import { InterviewDraftSchema, type ActionInstance, type InterviewDraft, type WorkflowNode } from '../draft/schema.js';
import { actionRefFor } from '../../workflow/action-definition.js';

function workflowNodeFromStep(step: Step): { node: WorkflowNode; action?: ActionInstance } | null {
  switch (step.type) {
    case 'action':
      return {
        node: {
          type: 'action',
          id: step.id,
          actionRef: step.actionRef ?? actionRefFor(step.connector, step.action),
        },
        action: {
          actionRef: step.actionRef ?? actionRefFor(step.connector, step.action),
          connector: step.connector,
          action: step.action,
          params: Object.fromEntries(
            Object.entries(step.params).map(([key, value]) => [key, String(value)]),
          ),
          bindings: step.bindings,
        },
      };
    case 'human_approval':
      return {
        node: {
          type: 'human_approval',
          id: step.id,
          reason: step.reason,
          forActionIds: step.forActionIds,
        },
      };
    case 'ai_decision':
      return {
        node: {
          type: 'ai_decision',
          id: step.id,
          goal: step.goal,
          memo: step.memo,
          investigation: step.investigation,
          outputFields: step.outputSchema
            ? Object.entries(
                (step.outputSchema.properties ?? {}) as Record<string, Record<string, unknown>>,
              ).map(([name, def]) => ({
                name,
                type: (def.type === 'number' ? 'number' : def.type === 'boolean' ? 'boolean' : 'string') as
                  | 'string'
                  | 'number'
                  | 'boolean',
                description: typeof def.description === 'string' ? def.description : name,
                enumValues: Array.isArray(def.enum) ? def.enum.map(String) : undefined,
              }))
            : undefined,
        },
      };
    case 'if':
      return {
        node: {
          type: 'if',
          id: step.id,
          condition: step.condition,
          thenStepIds: step.thenStepIds,
          elseStepIds: step.elseStepIds,
        },
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
  | 'triggerFilter'
  | 'slackChannel'
  | 'localFolderId'
  | 'localFolderPath'
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
    return { triggerType: 'once', runAt: trigger.runAt, triggerFilter: trigger.filter };
  }
  if (trigger?.type === 'manual') {
    return { triggerType: 'manual', triggerFilter: trigger.filter };
  }
  if (trigger?.type === 'gmail.new_message') {
    return {
      triggerType: 'gmail.new_message',
      gmailAccount: trigger.accountId,
      triggerFilter: trigger.filter,
    };
  }
  if (trigger?.type === 'slack.new_message') {
    return {
      triggerType: 'slack.new_message',
      slackChannel: trigger.channel,
      triggerFilter: trigger.filter,
    };
  }
  if (trigger?.type === 'local_folder.new_file') {
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

export function bootstrapInterviewFromWorkflow(ir: WorkflowIR, workflowId: string): InterviewState {
  const actions: InterviewDraft['actions'] = {};
  const nodes: WorkflowNode[] = [];

  for (const step of ir.steps ?? []) {
    const mapped = workflowNodeFromStep(step);
    if (!mapped) continue;
    nodes.push(mapped.node);
    if (mapped.action) actions[mapped.node.id] = mapped.action;
  }

  const workflow = InterviewDraftSchema.parse({
    name: ir.name,
    goal: ir.goal ?? ir.name,
    assumptions: ir.assumptions ?? [],
    nodes,
    actions,
    ...triggerFields(ir),
  });

  return {
    sessionId: randomUUID(),
    userInstruction: ir.goal ?? ir.name,
    workScope: resolveWorkScope({ workflow }),
    draftRevision: 0,
    draft: ir,
    workflow,
    slotValues: {},
    status: 'done',
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
