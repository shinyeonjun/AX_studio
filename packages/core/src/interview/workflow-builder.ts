import { capabilityActionName, resolveCapability } from '../catalog/capability-graph.js';
import { approvalReasonForAction } from '../runtime/approval-display.js';
import type { SideEffectLevel, WorkflowIR, Step } from '../workflow/schema.js';
import { renderWorkflowDocument } from './workflow-document.js';
import type { InterviewDraft, WorkflowNode } from './workflow-schema.js';
import { applyContractCompilation } from '../workflow/contract-adapters.js';
import { parseWorkflowIR } from '../workflow/schema.js';

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
import { GMAIL_READ_WORKFLOW_NODE_ID } from './workflow-constants.js';

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

function consolidateApprovals(steps: Step[], workName: string): Step[] {
  const withoutApprovals = steps.filter((step) => step.type !== 'human_approval');
  const out: Step[] = [];
  for (const step of withoutApprovals) {
    if (step.type === 'action' && step.sideEffect === 'EXTERNAL_HIGH') {
      out.push({
        type: 'human_approval',
        id: `approve_${step.id}`,
        reason: approvalReasonForAction(workName, step),
        forActionIds: [step.id],
      });
    }
    out.push(step);
  }
  return out;
}

function hasGmailReadStep(steps: Step[]): boolean {
  return steps.some(
    (step) =>
      step.type === 'action' &&
      step.connector === 'gmail' &&
      (step.action === 'messages.read' || step.action === 'message.read'),
  );
}

function injectGmailReadIfNeeded(steps: Step[], draft: InterviewDraft): Step[] {
  if (draft.triggerType !== 'gmail.new_message' || hasGmailReadStep(steps)) return steps;
  return [
    {
      type: 'action',
      id: GMAIL_READ_WORKFLOW_NODE_ID,
      connector: 'gmail',
      action: 'messages.read',
      params: { messageId: '{{messageId}}' },
      sideEffect: 'NONE',
    },
    ...steps,
  ];
}

function buildTrigger(draft: InterviewDraft): WorkflowIR['trigger'] | undefined {
  if (draft.triggerType === 'schedule') {
    if (!draft.schedule?.trim()) return undefined;
    return {
      type: 'schedule',
      schedule: draft.schedule.trim(),
      timezone: draft.timezone?.trim() || DEFAULT_TIMEZONE,
    };
  }
  if (draft.triggerType === 'once') {
    if (!draft.runAt?.trim()) return undefined;
    return { type: 'once', runAt: draft.runAt.trim() };
  }
  if (draft.triggerType === 'gmail.new_message') {
    if (!draft.gmailAccount?.trim()) return undefined;
    return { type: 'gmail.new_message', accountId: draft.gmailAccount.trim() };
  }
  if (draft.triggerType === 'slack.new_message') {
    if (!draft.slackChannel?.trim()) return undefined;
    return { type: 'slack.new_message', channel: draft.slackChannel.trim() };
  }
  if (draft.triggerType === 'local_folder.new_file') {
    if (!draft.localFolderId?.trim()) return undefined;
    const extensions = draft.localFolderExtensions
      ?.split(',')
      .map((ext) => ext.trim())
      .filter(Boolean);
    return {
      type: 'local_folder.new_file',
      folderId: draft.localFolderId.trim(),
      extensions: extensions?.length ? extensions : undefined,
    };
  }
  return { type: 'manual' };
}

const LOCAL_FOLDER_TRIGGER_INPUTS = [
  'folderId',
  'folderPath',
  'filePath',
  'fileName',
  'extension',
  'size',
  'modifiedAt',
] as const;

const GMAIL_TRIGGER_INPUTS = ['messageId', 'from', 'subject', 'snippet', 'sender'] as const;
const SLACK_TRIGGER_INPUTS = ['messageId', 'channel', 'text', 'user', 'sender', 'ts'] as const;

export function buildIRFromWorkflow(draft: InterviewDraft): Partial<WorkflowIR> {
  const rawSteps = draft.nodes.map(toStep).filter((step): step is Step => step !== null);
  const steps = consolidateApprovals(injectGmailReadIfNeeded(rawSteps, draft), draft.name);
  const ir: Partial<WorkflowIR> = {
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
          : draft.triggerType === 'local_folder.new_file'
            ? [...LOCAL_FOLDER_TRIGGER_INPUTS]
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
  const compiled = applyContractCompilation(parseWorkflowIR(ir));
  compiled.document = renderWorkflowDocument(compiled);
  return compiled;
}
