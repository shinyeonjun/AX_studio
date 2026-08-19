import { capabilityActionName, resolveCapability } from '../connectors/capability-graph.js';
import { approvalReasonForAction } from '../runtime/approval-display.js';
import type { SideEffectLevel, SkillIR, Step } from '../skill/schema.js';
import { renderWorkSkillMarkdown } from './work-skill-document.js';
import type { InterviewDraft, WorkflowNode } from './workflow-schema.js';

export class UnknownCapabilityError extends Error {
  readonly capability: string;

  constructor(capability: string) {
    const hint =
      capability.includes('send_message') ?
        `${capability} → slack/gmail은 message.send 를 사용하세요 (예: slack.message.send)`
      : capability.includes('slack.') && !capability.includes('message.send') ?
        `${capability} → catalog id는 slack.message.send 입니다`
      : '';
    super(`지원하지 않는 capability입니다: ${capability}${hint ? `. ${hint}` : ''}`);
    this.name = 'UnknownCapabilityError';
    this.capability = capability;
  }
}

const DEFAULT_TIMEZONE = 'Asia/Seoul';

function outputSchemaFromFields(node: WorkflowNode): Record<string, unknown> {
  const fields = node.outputFields?.length
    ? node.outputFields
    : [{ name: 'result', type: 'string' as const, description: node.goal ?? '결과' }];
  return {
    type: 'object',
    properties: Object.fromEntries(
      fields.map((field) => [field.name, { type: field.type, description: field.description }]),
    ),
  };
}

function toActionStep(node: WorkflowNode): Step | null {
  if (!node.connector || !node.action) return null;
  const cap = resolveCapability(node.connector, node.action);
  if (!cap) {
    throw new UnknownCapabilityError(`${node.connector}.${node.action}`);
  }
  return {
    type: 'action',
    id: node.id,
    connector: cap.connector,
    action: capabilityActionName(cap),
    params: node.params ?? {},
    sideEffect: (cap.sideEffect as SideEffectLevel | undefined) ?? 'EXTERNAL',
  };
}

function toStep(node: WorkflowNode): Step | null {
  switch (node.type) {
    case 'action':
      return toActionStep(node);
    case 'ai_decision':
      return {
        type: 'ai_decision',
        id: node.id,
        goal: node.goal ?? '판단',
        outputSchema: outputSchemaFromFields(node),
        investigation: node.investigation ?? false,
        maxReads: node.investigation ? 4 : 1,
      };
    case 'if':
      if (!node.condition) return null;
      return {
        type: 'if',
        id: node.id,
        condition: node.condition,
        thenStepIds: node.thenStepIds ?? [],
        elseStepIds: node.elseStepIds,
      };
    case 'human_approval':
      return {
        type: 'human_approval',
        id: node.id,
        reason: node.reason ?? '실행 전 승인',
        forActionIds: node.forActionIds ?? [],
      };
  }
}

function consolidateApprovals(steps: Step[], skillName: string): Step[] {
  const withoutApprovals = steps.filter((step) => step.type !== 'human_approval');
  const out: Step[] = [];
  for (const step of withoutApprovals) {
    if (step.type === 'action' && step.sideEffect === 'EXTERNAL_HIGH') {
      out.push({
        type: 'human_approval',
        id: `approve_${step.id}`,
        reason: approvalReasonForAction(skillName, step),
        forActionIds: [step.id],
      });
    }
    out.push(step);
  }
  return out;
}

function buildTrigger(draft: InterviewDraft): SkillIR['trigger'] {
  if (draft.triggerType === 'schedule') {
    return {
      type: 'schedule',
      schedule: draft.schedule ?? '0 9 * * 1',
      timezone: draft.timezone ?? DEFAULT_TIMEZONE,
    };
  }
  if (draft.triggerType === 'once') {
    return { type: 'once', runAt: draft.runAt ?? new Date(Date.now() + 60_000).toISOString() };
  }
  if (draft.triggerType === 'gmail.new_message') {
    return { type: 'gmail.new_message', accountId: draft.gmailAccount ?? 'primary' };
  }
  if (draft.triggerType === 'slack.new_message') {
    return { type: 'slack.new_message', channel: draft.slackChannel ?? '#general' };
  }
  return { type: 'manual' };
}

const GMAIL_TRIGGER_INPUTS = ['messageId', 'from', 'subject', 'body', 'sender', 'snippet'] as const;
const SLACK_TRIGGER_INPUTS = ['messageId', 'channel', 'text', 'user', 'sender', 'ts'] as const;

export function buildIRFromWorkflow(draft: InterviewDraft): Partial<SkillIR> {
  const steps = consolidateApprovals(
    draft.nodes.map(toStep).filter((step): step is Step => step !== null),
    draft.name,
  );
  const ir: Partial<SkillIR> = {
    name: draft.name,
    goal: draft.goal,
    version: 1,
    trigger: buildTrigger(draft),
    steps,
    success: draft.success ?? '작업 완료',
    assumptions: draft.assumptions,
    inputs:
      draft.triggerType === 'gmail.new_message'
        ? [...GMAIL_TRIGGER_INPUTS]
        : draft.triggerType === 'slack.new_message'
          ? [...SLACK_TRIGGER_INPUTS]
          : [],
    permissions: {},
    approval: steps
      .filter((step): step is Extract<Step, { type: 'action' }> =>
        step.type === 'action' && step.sideEffect === 'EXTERNAL_HIGH',
      )
      .map((step) => `${step.connector}.${step.action}`),
    allowExternalAuto: true,
    dataPolicy: { emailBody: { cloudAllowed: false } },
    sideEffects: Object.fromEntries(
      steps.filter((step) => step.type === 'action').map((step) => [step.id, step.sideEffect]),
    ),
  };
  ir.document = renderWorkSkillMarkdown(ir);
  return ir;
}
