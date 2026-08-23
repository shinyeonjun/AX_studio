import { capabilityActionName, resolveCapability } from '../../../catalog/capability-graph.js';
import type { SideEffectLevel, WorkflowIR, Step } from '../../../workflow/schema.js';
import { renderWorkflowDocument } from '../presentation/workflow-document.js';
import type { WorkflowCanvasDraft, WorkflowCanvasDraftInput, WorkflowNode } from '../draft/schema.js';
import { WorkflowCanvasDraftSchema } from '../draft/schema.js';
import { getNodeBindings, getNodeParams, normalizeDraftActions, resolveNodeConnectorAction } from '../draft/actions.js';
import { normalizeDraftIfConditions, resolveIfNodeCondition } from '../draft/conditions.js';
import { applyContractCompilation } from '../../../workflow/contract-adapters.js';
import { parseWorkflowIR, validateWorkflowIR } from '../../../workflow/schema.js';
import { GMAIL_READ_WORKFLOW_NODE_ID } from './constants.js';
import { validateCanvasDraftStructure } from './validate-graph.js';

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

function toActionStep(draft: WorkflowCanvasDraft, node: WorkflowNode): Step | null {
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

function toStep(draft: WorkflowCanvasDraft, node: WorkflowNode): Step | null {
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
    case 'if': {
      const condition = resolveIfNodeCondition(node);
      if (!condition) {
        throw new Error(`${node.id} if 노드에 condition이 필요합니다.`);
      }
      return {
        type: 'if',
        id: node.id,
        condition,
        thenStepIds: node.thenStepIds ?? [],
        elseStepIds: node.elseStepIds,
      };
    }
    case 'human_approval':
      return {
        type: 'human_approval',
        id: node.id,
        reason: node.reason?.trim() ?? '',
        forActionIds: node.forActionIds ?? [],
      };
  }
}

function consolidateApprovals(steps: Step[]): Step[] {
  // External side-effect approval is owned by action execution. Keep only
  // valid, explicitly branched legacy gates so a flat approval node cannot
  // run outside the branch that selected its action.
  return steps.filter(
    (step) => step.type !== 'human_approval' || step.forActionIds.length > 0,
  );
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

function workflowInputs(triggerType: WorkflowCanvasDraft['triggerType'], steps: Step[]): string[] {
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

function injectGmailReadIfNeeded(steps: Step[], draft: WorkflowCanvasDraft): Step[] {
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

function buildTrigger(draft: WorkflowCanvasDraft): WorkflowIR['trigger'] | undefined {
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

function toActionStepLenient(draft: WorkflowCanvasDraft, node: WorkflowNode): Step | null {
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

function toStepLenient(draft: WorkflowCanvasDraft, node: WorkflowNode): Step | null {
  try {
    if (node.type === 'action') return toActionStepLenient(draft, node);
    return toStep(draft, node);
  } catch {
    // Lenient compilation exists only to expose the rest of the draft to the
    // deterministic slot/graph validator. A malformed branch must not mask
    // the actual graph issue by throwing from the lenient path itself.
    return null;
  }
}

export function buildLenientIRFromWorkflow(draft: WorkflowCanvasDraftInput): Partial<WorkflowIR> {
  const normalizedDraft = normalizeDraftIfConditions(
    normalizeDraftActions(WorkflowCanvasDraftSchema.parse(draft)),
  );
  const rawSteps = normalizedDraft.nodes
    .map((node) => toStepLenient(normalizedDraft, node))
    .filter((step): step is Step => step !== null);
  const steps = consolidateApprovals(injectGmailReadIfNeeded(rawSteps, normalizedDraft));
  const ir: Partial<WorkflowIR> = {
    name: normalizedDraft.name,
    goal: normalizedDraft.goal,
    version: 1,
    trigger: buildTrigger(normalizedDraft),
    steps,
    success: normalizedDraft.success,
    assumptions: normalizedDraft.assumptions,
    inputs: workflowInputs(normalizedDraft.triggerType, steps),
    permissions: {},
    approval: steps
      .filter((step): step is Extract<Step, { type: 'action' }> =>
        step.type === 'action' && step.sideEffect === 'EXTERNAL_HIGH',
      )
      .map((step) => `${step.connector}.${step.action}`),
    allowExternalAuto: false,
    dataPolicy: {
      emailBody: { cloudAllowed: true },
      document: { cloudAllowed: true },
    },
    sideEffects: Object.fromEntries(
      steps.filter((step) => step.type === 'action').map((step) => [step.id, step.sideEffect]),
    ),
  };
  // Conversational completeness may inspect a partial IR, but only a schema-
  // valid IR may enter contract compilation. Invalid partial data remains
  // visible as-is so the slot layer can ask for it instead of hiding a parser
  // or compiler defect behind a generic fallback.
  const validation = validateWorkflowIR(ir);
  if (!validation.ok) return ir;

  const compiled = applyContractCompilation(validation.value);
  compiled.document = renderWorkflowDocument(compiled);
  return compiled;
}

export function buildIRFromWorkflow(draft: WorkflowCanvasDraftInput): Partial<WorkflowIR> {
  const parsed = WorkflowCanvasDraftSchema.parse(draft);
  const normalized = normalizeDraftIfConditions(normalizeDraftActions(parsed));
  const graphIssues = validateCanvasDraftStructure(normalized);
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

  const steps = consolidateApprovals(injectGmailReadIfNeeded(rawSteps, normalized));
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
    allowExternalAuto: false,
    dataPolicy: {
      emailBody: { cloudAllowed: true },
      document: { cloudAllowed: true },
    },
    sideEffects: Object.fromEntries(
      steps.filter((step) => step.type === 'action').map((step) => [step.id, step.sideEffect]),
    ),
  };
  const compiled = applyContractCompilation(parseWorkflowIR(ir));
  compiled.document = renderWorkflowDocument(compiled);
  return compiled;
}
