import type { WorkflowIR, Step } from '../workflow/schema.js';
import { isConnectorAlwaysOn, paramSlotId, resolveCapability } from '../catalog/capability-graph.js';
import { requirementCopy, type RequirementQuestionKey } from '../i18n/ko.js';
import {
  validateWorkflowContracts,
  type ContractValidationIssue,
} from '../workflow/contract-validator.js';
import { parseWorkflowIR } from '../workflow/schema.js';

export type RequirementSlot = string;

export interface SlotState {
  slot: RequirementSlot;
  filled: boolean;
  label?: string;
  question?: string;
}

export interface CompletenessResult {
  slots: SlotState[];
  missingRequired: RequirementSlot[];
  deployable: boolean;
  missingConnections: string[];
  contractIssues?: ContractValidationIssue[];
}

const CORE_QUESTIONS: Record<RequirementQuestionKey, { label: string; question: string }> = {
  goal: requirementCopy('goal'),
  trigger: requirementCopy('trigger'),
  'trigger.schedule': requirementCopy('trigger.schedule'),
  'trigger.timezone': requirementCopy('trigger.timezone'),
  'trigger.runAt': requirementCopy('trigger.runAt'),
  action: requirementCopy('action'),
  approval: requirementCopy('approval'),
  completion: requirementCopy('completion'),
  'ai_decision.schema': requirementCopy('ai_decision.schema'),
};

function hasExternalHigh(steps: Step[]): boolean {
  return steps.some((s) => s.type === 'action' && s.sideEffect === 'EXTERNAL_HIGH');
}

function paramValue(step: Extract<Step, { type: 'action' }>, name: string): string | undefined {
  const value = step.params[name];
  return typeof value === 'string' ? value.trim() : value != null ? String(value) : undefined;
}

export function computeRequiredSlots(ir: Partial<WorkflowIR>): SlotState[] {
  const slots: SlotState[] = [
    {
      slot: 'goal',
      filled: Boolean(ir.goal?.trim()),
      ...CORE_QUESTIONS.goal,
    },
  ];

  if (!ir.trigger) {
    slots.push({ slot: 'trigger', filled: false, ...CORE_QUESTIONS.trigger });
  } else if (ir.trigger.type === 'schedule') {
    slots.push({
      slot: 'trigger.schedule',
      filled: Boolean(ir.trigger.schedule),
      ...CORE_QUESTIONS['trigger.schedule'],
    });
    slots.push({
      slot: 'trigger.timezone',
      filled: Boolean(ir.trigger.timezone),
      ...CORE_QUESTIONS['trigger.timezone'],
    });
  } else if (ir.trigger.type === 'once') {
    slots.push({
      slot: 'trigger.runAt',
      filled: Boolean(ir.trigger.runAt),
      ...CORE_QUESTIONS['trigger.runAt'],
    });
  }

  const steps = ir.steps ?? [];
  if (steps.length === 0) {
    slots.push({ slot: 'action', filled: false, ...CORE_QUESTIONS.action });
  }

  if (steps.some((s) => s.type === 'ai_decision')) {
    slots.push({
      slot: 'ai_decision.schema',
      filled: steps.every((s) => s.type !== 'ai_decision' || Boolean(s.outputSchema)),
      ...CORE_QUESTIONS['ai_decision.schema'],
    });
  }

  for (const step of steps) {
    if (step.type !== 'action') continue;
    const cap = resolveCapability(step.connector, step.action);
    for (const param of cap?.params ?? []) {
      if (!param.required) continue;
      slots.push({
        slot: paramSlotId(cap!, param.name),
        filled: Boolean(paramValue(step, param.name)),
        label: param.label,
        question: param.question,
      });
    }
  }

  if (ir.trigger?.type === 'gmail.new_message') {
    const cap = resolveCapability('gmail', 'new_message');
    const accountParam = cap?.params.find((p) => p.name === 'accountId');
    slots.push({
      slot: cap && accountParam ? paramSlotId(cap, 'accountId') : 'gmail.new_message.accountId',
      filled: Boolean(ir.trigger.accountId),
      label: accountParam?.label ?? 'Gmail 계정',
      question: accountParam?.question ?? '어떤 Gmail 계정을 사용할까요?',
    });
  }

  if (ir.trigger?.type === 'slack.new_message') {
    const cap = resolveCapability('slack', 'new_message');
    const channelParam = cap?.params.find((p) => p.name === 'channel');
    slots.push({
      slot: cap && channelParam ? paramSlotId(cap, 'channel') : 'slack.new_message.channel',
      filled: Boolean(ir.trigger.channel),
      label: channelParam?.label ?? 'Slack 채널',
      question: channelParam?.question ?? '어떤 Slack 채널을 감시할까요?',
    });
  }

  if (ir.trigger?.type === 'local_folder.new_file') {
    const cap = resolveCapability('local_folder', 'new_file');
    const folderParam = cap?.params.find((p) => p.name === 'folderId');
    slots.push({
      slot: cap && folderParam ? paramSlotId(cap, 'folderId') : 'local_folder.new_file.folderId',
      filled: Boolean(ir.trigger.folderId),
      label: folderParam?.label ?? '연결 폴더',
      question: folderParam?.question ?? '어떤 폴더를 감시할까요?',
    });
  }

  if (hasExternalHigh(steps)) {
    slots.push({
      slot: 'approval',
      filled: steps.some((s) => s.type === 'human_approval' && s.forActionIds.length > 0),
      ...CORE_QUESTIONS.approval,
    });
  }

  if (!ir.success) {
    slots.push({ slot: 'completion', filled: false, ...CORE_QUESTIONS.completion });
  } else {
    slots.push({ slot: 'completion', filled: true, ...CORE_QUESTIONS.completion });
  }

  return slots;
}

export function assessCompleteness(
  ir: Partial<WorkflowIR>,
  connectedConnectors: string[] = [],
): CompletenessResult {
  const slots = computeRequiredSlots(ir);
  const missingRequired = slots.filter((s) => !s.filled).map((s) => s.slot);

  const neededConnectors = new Set<string>();
  for (const step of ir.steps ?? []) {
    if (step.type === 'action' && !isConnectorAlwaysOn(step.connector)) {
      neededConnectors.add(step.connector);
    }
  }
  if (ir.trigger?.type === 'gmail.new_message') neededConnectors.add('gmail');
  if (ir.trigger?.type === 'slack.new_message') neededConnectors.add('slack');
  if (ir.trigger?.type === 'local_folder.new_file') neededConnectors.add('local_folder');

  const missingConnections = [...neededConnectors].filter((c) => !connectedConnectors.includes(c));

  let contractIssues: ContractValidationIssue[] = [];
  if ((ir.steps?.length ?? 0) > 0 && ir.trigger && missingRequired.length === 0) {
    try {
      contractIssues = validateWorkflowContracts(parseWorkflowIR(ir));
    } catch {
      contractIssues = [];
    }
  }

  for (const issue of contractIssues) {
    slots.push({
      slot: issue.stepId ? `contract.${issue.stepId}` : 'contract.workflow',
      filled: false,
      label: '데이터 연결',
      question: issue.message,
    });
  }

  const deployable =
    missingRequired.length === 0 &&
    missingConnections.length === 0 &&
    contractIssues.length === 0 &&
    (ir.steps?.length ?? 0) > 0;

  return { slots, missingRequired, deployable, missingConnections, contractIssues };
}

export function getNextQuestion(result: CompletenessResult): string | null {
  if (result.missingConnections.length > 0) {
    return `${result.missingConnections.join(', ')} 연결이 필요합니다. 설정에서 연결해주세요.`;
  }
  if (result.contractIssues?.length) {
    return result.contractIssues[0]?.message ?? null;
  }
  const next = result.slots.find((s) => !s.filled);
  return next?.question ?? null;
}

export function slotLabel(slot: SlotState): string {
  if (slot.label) return slot.label;
  if (slot.slot in CORE_QUESTIONS) {
    return CORE_QUESTIONS[slot.slot as RequirementQuestionKey].label;
  }
  return slot.slot;
}
