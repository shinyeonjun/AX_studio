import { capabilityActionName, resolveCapability } from '../../catalog/capability-graph.js';
import { approvalReasonForAction } from '../../runtime/approval-display.js';
import type { SideEffectLevel, WorkflowIR, Step } from '../../workflow/schema.js';
import { renderWorkflowDocument } from '../presentation/workflow-document.js';
import type { InterviewDraft, WorkflowNode } from '../draft/schema.js';
import { getNodeBindings, getNodeParams, normalizeDraftActions, resolveNodeConnectorAction } from '../draft/actions.js';
import { applyContractCompilation } from '../../workflow/contract-adapters.js';
import { parseWorkflowIR, validateWorkflowIR } from '../../workflow/schema.js';
import { GMAIL_READ_WORKFLOW_NODE_ID } from './constants.js';
import { validateInterviewDraftStructure } from './validate-graph.js';

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

function outputSchemaFromFields(node: WorkflowNode): Record<string, unknown> | undefined {
  const fields = node.outputFields?.filter((field) => field.name.trim() && field.description.trim()) ?? [];
  if (fields.length === 0) return undefined;
  return {
    type: 'object',
    properties: Object.fromEntries(
      fields.map((field) => [
        field.name,
        {
          type: field.type,
          description: field.description,
          ...(field.enumValues?.length ? { enum: field.enumValues } : {}),
        },
      ]),
    ),
    required: fields.map((field) => field.name),
  };
}

function toActionStep(draft: InterviewDraft, node: WorkflowNode): Step | null {
  const resolved = resolveNodeConnectorAction(draft, node);
  if (!resolved) return null;

  const cap = resolveCapability(resolved.connector, resolved.action);
  if (!cap) {
    throw new UnknownCapabilityError(resolved.actionRef);
  }

  return {
    type: 'action',
    id: node.id,
    connector: cap.connector,
    action: capabilityActionName(cap),
    actionRef: resolved.actionRef,
    params: getNodeParams(draft, node),
    bindings: getNodeBindings(draft, node),
    sideEffect: (cap.sideEffect as SideEffectLevel | undefined) ?? 'EXTERNAL',
  };
}

function toStep(draft: InterviewDraft, node: WorkflowNode): Step | null {
  switch (node.type) {
    case 'action':
      return toActionStep(draft, node);
    case 'ai_decision':
      return {
        type: 'ai_decision',
        id: node.id,
        goal: node.goal?.trim() ?? '',
        memo: node.memo?.trim() || undefined,
        outputSchema: outputSchemaFromFields(node),
        investigation: node.investigation ?? false,
        maxReads: node.investigation ? 4 : 1,
        bindings: node.bindings,
      };
    case 'if':
      if (!node.condition) {
        throw new Error(`${node.id} if 노드에 condition이 필요합니다.`);
      }
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
        reason: node.reason?.trim() ?? '',
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

function hasDocumentIngestStep(steps: Step[]): boolean {
  return steps.some(
    (step) => step.type === 'action' && step.connector === 'document' && step.action === 'ingest',
  );
}

function workflowInputs(triggerType: InterviewDraft['triggerType'], steps: Step[]): string[] {
  if (triggerType === 'gmail.new_message') return [...GMAIL_TRIGGER_INPUTS];
  if (triggerType === 'slack.new_message') return [...SLACK_TRIGGER_INPUTS];
  if (triggerType === 'local_folder.new_file') return [...LOCAL_FOLDER_TRIGGER_INPUTS];
  // A one-time document workflow receives the selected/latest connected file
  // as manual-run input. This is a data contract, not another trigger.
  if (triggerType === 'manual' && hasDocumentIngestStep(steps)) {
    return [...LOCAL_FOLDER_TRIGGER_INPUTS];
  }
  return [];
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
  if (!draft.triggerType) return undefined;

  if (draft.triggerType === 'schedule') {
    return {
      type: 'schedule',
      schedule: draft.schedule?.trim() ?? '',
      timezone: draft.timezone?.trim() ?? '',
      filter: draft.triggerFilter,
    };
  }
  if (draft.triggerType === 'once') {
    return { type: 'once', runAt: draft.runAt?.trim() ?? '', filter: draft.triggerFilter };
  }
  if (draft.triggerType === 'gmail.new_message') {
    return {
      type: 'gmail.new_message',
      accountId: draft.gmailAccount?.trim() ?? '',
      filter: draft.triggerFilter,
    };
  }
  if (draft.triggerType === 'slack.new_message') {
    return {
      type: 'slack.new_message',
      channel: draft.slackChannel?.trim() ?? '',
      filter: draft.triggerFilter,
    };
  }
  if (draft.triggerType === 'local_folder.new_file') {
    const extensions = draft.localFolderExtensions
      ?.split(',')
      .map((ext) => ext.trim())
      .filter(Boolean);
    return {
      type: 'local_folder.new_file',
      folderId: draft.localFolderId?.trim() ?? '',
      folderPath: draft.localFolderPath?.trim() || undefined,
      extensions: extensions?.length ? extensions : undefined,
      filter: draft.triggerFilter,
    };
  }
  if (draft.triggerType === 'manual') {
    return { type: 'manual', filter: draft.triggerFilter };
  }
  return undefined;
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

function toActionStepLenient(draft: InterviewDraft, node: WorkflowNode): Step | null {
  const resolved = resolveNodeConnectorAction(draft, node);
  if (!resolved) return null;

  const cap = resolveCapability(resolved.connector, resolved.action);
  if (!cap) return null;

  return {
    type: 'action',
    id: node.id,
    connector: cap.connector,
    action: capabilityActionName(cap),
    actionRef: resolved.actionRef,
    params: getNodeParams(draft, node),
    bindings: getNodeBindings(draft, node),
    sideEffect: (cap.sideEffect as SideEffectLevel | undefined) ?? 'EXTERNAL',
  };
}

function toStepLenient(draft: InterviewDraft, node: WorkflowNode): Step | null {
  if (node.type === 'action') return toActionStepLenient(draft, node);
  return toStep(draft, node);
}

export function buildLenientIRFromWorkflow(draft: InterviewDraft): Partial<WorkflowIR> {
  const normalized = normalizeDraftActions(draft);
  const rawSteps = normalized.nodes
    .map((node) => toStepLenient(normalized, node))
    .filter((step): step is Step => step !== null);
  const steps = consolidateApprovals(injectGmailReadIfNeeded(rawSteps, normalized), normalized.name);
  const ir: Partial<WorkflowIR> = {
    name: normalized.name,
    goal: normalized.goal,
    version: 1,
    trigger: buildTrigger(normalized),
    steps,
    success: normalized.success,
    assumptions: normalized.assumptions,
    inputs: workflowInputs(normalized.triggerType, steps),
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
  // Conversational completeness may inspect a partial IR, but only a schema-
  // valid IR may enter contract compilation. Invalid partial data remains
  // visible as-is so the slot layer can ask for it instead of hiding a parser
  // or compiler defect behind a generic fallback.
  const parsed = validateWorkflowIR(ir);
  if (!parsed.ok) return ir;

  const compiled = applyContractCompilation(parsed.value);
  compiled.document = renderWorkflowDocument(compiled);
  return compiled;
}

export function buildIRFromWorkflow(draft: InterviewDraft): Partial<WorkflowIR> {
  const normalized = normalizeDraftActions(draft);
  const graphIssues = validateInterviewDraftStructure(normalized);
  if (graphIssues.length > 0) {
    const error = new Error(graphIssues[0]!.message) as Error & {
      code: string;
      issues: typeof graphIssues;
    };
    error.code = 'workflow_graph_invalid';
    error.issues = graphIssues;
    throw error;
  }
  const rawSteps = normalized.nodes
    .map((node) => toStep(normalized, node))
    .filter((step): step is Step => step !== null);

  for (const node of normalized.nodes) {
    if (node.type !== 'action') continue;
    if (rawSteps.some((step) => step.type === 'action' && step.id === node.id)) continue;

    const instance = normalized.actions?.[node.id];
    const hasCapabilityChoice = Boolean(
      node.actionRef?.trim() ||
        instance?.actionRef?.trim() ||
        instance?.connector?.trim() ||
        instance?.action?.trim(),
    );
    if (!hasCapabilityChoice) continue;

    const resolved = resolveNodeConnectorAction(normalized, node);
    throw new UnknownCapabilityError(
      resolved?.actionRef ??
        instance?.actionRef ??
        node.actionRef ??
        `${instance?.connector ?? 'unknown'}.${instance?.action ?? 'unknown'}`,
    );
  }

  const steps = consolidateApprovals(injectGmailReadIfNeeded(rawSteps, normalized), normalized.name);
  const ir: Partial<WorkflowIR> = {
    name: normalized.name,
    goal: normalized.goal,
    version: 1,
    trigger: buildTrigger(normalized),
    steps,
    success: normalized.success,
    assumptions: normalized.assumptions,
    inputs: workflowInputs(normalized.triggerType, steps),
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
