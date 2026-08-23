import type { WorkflowIR, Step } from '../../../workflow/schema.js';
import { isConnectorAlwaysOn, paramSlotId, resolveCapability } from '../../../catalog/capability-graph.js';
import { actionRefFor, resolveActionDefinition, validateActionParams } from '../../../workflow/action-definition.js';
import { requirementCopy, type RequirementQuestionKey } from '../../../i18n/ko.js';
import { validateWorkflowContracts, type ContractValidationIssue } from '../../../workflow/contract-validator.js';
import { parseWorkflowIR } from '../../../workflow/schema.js';
import { nodeParamSlotId, nodeSlotLabel, nodeSlotQuestion, nodeTextSlotId } from './ids.js';
import { branchHintsFromWorkflow } from './branch-hints.js';
import { actionStepParamFilled } from './filled.js';
import type { CompletenessResult, SlotState } from './types.js';

export type { RequirementSlot, SlotState, CompletenessResult } from './types.js';

const CORE_QUESTIONS: Record<RequirementQuestionKey, { label: string; question: string }> = {
  goal: requirementCopy('goal'),
  trigger: requirementCopy('trigger'),
  'trigger.schedule': requirementCopy('trigger.schedule'),
  'trigger.timezone': requirementCopy('trigger.timezone'),
  'trigger.runAt': requirementCopy('trigger.runAt'),
  action: requirementCopy('action'),
  approval: requirementCopy('approval'),
  completion: requirementCopy('completion'),
  'ai_decision.goal': requirementCopy('ai_decision.goal'),
  'ai_decision.schema': requirementCopy('ai_decision.schema'),
  'human_approval.reason': requirementCopy('human_approval.reason'),
};

function hasExternalHigh(steps: Step[]): boolean {
  return steps.some((s) => s.type === 'action' && s.sideEffect === 'EXTERNAL_HIGH');
}

export function computeRequiredSlots(ir: Partial<WorkflowIR>): SlotState[] {
  const slots: SlotState[] = [{ slot: 'goal', filled: Boolean(ir.goal?.trim()), ...CORE_QUESTIONS.goal }];
  if (!ir.trigger) {
    slots.push({ slot: 'trigger', filled: false, ...CORE_QUESTIONS.trigger });
  } else if (ir.trigger.type === 'schedule') {
    slots.push({ slot: 'trigger.schedule', filled: Boolean(ir.trigger.schedule), ...CORE_QUESTIONS['trigger.schedule'] });
    slots.push({ slot: 'trigger.timezone', filled: Boolean(ir.trigger.timezone), ...CORE_QUESTIONS['trigger.timezone'] });
  } else if (ir.trigger.type === 'once') {
    slots.push({ slot: 'trigger.runAt', filled: Boolean(ir.trigger.runAt), ...CORE_QUESTIONS['trigger.runAt'] });
  }

  const steps = ir.steps ?? [];
  if (steps.length === 0) slots.push({ slot: 'action', filled: false, ...CORE_QUESTIONS.action });
  const branchHints = branchHintsFromWorkflow(ir);
  for (const step of steps) {
    if (step.type === 'ai_decision' && !step.goal.trim()) {
      slots.push({
        slot: nodeTextSlotId(step.id, 'goal'),
        filled: false,
        label: nodeSlotLabel(step.id, CORE_QUESTIONS['ai_decision.goal'].label),
        question: nodeSlotQuestion(step.id, CORE_QUESTIONS['ai_decision.goal'].question, branchHints.get(step.id)),
      });
    }
    if (step.type === 'human_approval' && !step.reason.trim()) {
      slots.push({
        slot: nodeTextSlotId(step.id, 'reason'),
        filled: false,
        label: nodeSlotLabel(step.id, CORE_QUESTIONS['human_approval.reason'].label),
        question: nodeSlotQuestion(step.id, CORE_QUESTIONS['human_approval.reason'].question, branchHints.get(step.id)),
      });
    }
  }
  if (steps.some((s) => s.type === 'ai_decision')) {
    slots.push({
      slot: 'ai_decision.schema',
      filled: steps.every((s) => {
        if (s.type !== 'ai_decision') return true;
        const properties = s.outputSchema?.properties;
        return Boolean(properties && typeof properties === 'object' && !Array.isArray(properties) && Object.keys(properties).length > 0);
      }),
      ...CORE_QUESTIONS['ai_decision.schema'],
    });
  }
  for (const step of steps) {
    if (step.type !== 'action') continue;
    const actionRef = step.actionRef ?? actionRefFor(step.connector, step.action);
    const definition = resolveActionDefinition(actionRef);
    if (!definition) continue;
    for (const name of validateActionParams(definition, step.params)) {
      const slotId = nodeParamSlotId(step.id, name);
      if (slots.some((slot) => slot.slot === slotId)) continue;
      const paramDef = definition.params.find((param) => param.name === name);
      const label = paramDef?.label ?? name;
      const question = paramDef?.question ?? `${label}을(를) 알려주세요.`;
      slots.push({
        slot: slotId,
        filled: actionStepParamFilled(step, name),
        label: nodeSlotLabel(step.id, label),
        question: nodeSlotQuestion(step.id, question, branchHints.get(step.id)),
      });
    }
  }
  if (ir.trigger?.type === 'gmail.new_message') {
    const cap = resolveCapability('gmail', 'new_message');
    const accountParam = cap?.params.find((p) => p.name === 'accountId');
    slots.push({ slot: cap && accountParam ? paramSlotId(cap, 'accountId') : 'gmail.new_message.accountId', filled: Boolean(ir.trigger.accountId), label: accountParam?.label ?? 'Gmail 계정', question: accountParam?.question ?? '어떤 Gmail 계정을 사용할까요?' });
  }
  if (ir.trigger?.type === 'slack.new_message') {
    const cap = resolveCapability('slack', 'new_message');
    const channelParam = cap?.params.find((p) => p.name === 'channel');
    slots.push({ slot: cap && channelParam ? paramSlotId(cap, 'channel') : 'slack.new_message.channel', filled: Boolean(ir.trigger.channel), label: channelParam?.label ?? 'Slack 채널', question: channelParam?.question ?? '어떤 Slack 채널을 감시할까요?' });
  }
  if (ir.trigger?.type === 'local_folder.new_file') {
    const cap = resolveCapability('local_folder', 'new_file');
    const folderParam = cap?.params.find((p) => p.name === 'folderId');
    slots.push({ slot: cap && folderParam ? paramSlotId(cap, 'folderId') : 'local_folder.new_file.folderId', filled: Boolean(ir.trigger.folderId), label: folderParam?.label ?? '연결 폴더', question: folderParam?.question ?? '어떤 폴더를 감시할까요?' });
  }
  if (hasExternalHigh(steps)) {
    slots.push({
      slot: 'approval',
      filled: true,
      ...CORE_QUESTIONS.approval,
    });
  }
  slots.push({ slot: 'completion', filled: Boolean(ir.success), ...CORE_QUESTIONS.completion });
  return slots;
}

export function assessCompleteness(ir: Partial<WorkflowIR>, connectedConnectors: string[] = []): CompletenessResult {
  const slots = computeRequiredSlots(ir);
  const missingRequired = slots.filter((s) => !s.filled).map((s) => s.slot);
  const neededConnectors = new Set<string>();
  for (const step of ir.steps ?? []) if (step.type === 'action' && !isConnectorAlwaysOn(step.connector)) neededConnectors.add(step.connector);
  if (ir.trigger?.type === 'gmail.new_message') neededConnectors.add('gmail');
  if (ir.trigger?.type === 'slack.new_message') neededConnectors.add('slack');
  if (ir.trigger?.type === 'local_folder.new_file') neededConnectors.add('local_folder');
  const missingConnections = [...neededConnectors].filter((c) => !connectedConnectors.includes(c));
  let contractIssues: ContractValidationIssue[] = [];
  if ((ir.steps?.length ?? 0) > 0 && ir.trigger && missingRequired.length === 0) {
    try {
      contractIssues = validateWorkflowContracts(parseWorkflowIR(ir));
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      contractIssues = [{ code: 'invalid_workflow_schema', message: `workflow 데이터 계약을 해석할 수 없습니다${detail ? `: ${detail}` : '.'}` }];
    }
  }
  for (const contractIssue of contractIssues) {
    slots.push({ slot: contractIssue.stepId ? `contract.${contractIssue.stepId}` : 'contract.workflow', filled: false, label: '데이터 연결', question: contractIssue.message });
  }
  const deployable = missingRequired.length === 0 && missingConnections.length === 0 && contractIssues.length === 0 && (ir.steps?.length ?? 0) > 0;
  return { slots, missingRequired, deployable, missingConnections, contractIssues };
}

export function missingQuestionSlots(result: CompletenessResult): SlotState[] {
  return result.slots.filter((slot) => !slot.filled && slot.question);
}
export function getNextQuestion(result: CompletenessResult): string | null {
  return missingQuestionSlots(result)[0]?.question ?? null;
}
