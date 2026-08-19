import type { SkillIR, Step } from '../skill/schema.js';
import { isConnectorAlwaysOn, paramSlotId, resolveCapability } from '../connectors/capability-graph.js';

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
}

const CORE_QUESTIONS: Record<string, { label: string; question: string }> = {
  goal: { label: '지시 의도', question: '이 업무의 목적을 한 문장으로 말해주세요.' },
  trigger: { label: '트리거', question: '언제 이 업무를 실행할까요? (예: 새 메일, 매주 금요일)' },
  'trigger.schedule': { label: '스케줄', question: '실행 스케줄을 알려주세요.' },
  'trigger.timezone': { label: '타임존', question: '시간대는 어디로 할까요?' },
  'trigger.runAt': { label: '예약 시각', question: '언제 한 번 실행할까요?' },
  action: { label: '실행 액션', question: '실행할 작업을 설명해주세요.' },
  approval: { label: '승인', question: '누구의 승인이 필요한가요? 어떤 조건에서 승인할까요?' },
  completion: { label: '완료 조건', question: '업무가 완료되었다고 볼 조건은 무엇인가요?' },
  'ai_decision.schema': { label: 'AI 출력 스키마', question: 'AI가 어떤 형태로 결과를 내야 할까요?' },
};

function hasExternalHigh(steps: Step[]): boolean {
  return steps.some((s) => s.type === 'action' && s.sideEffect === 'EXTERNAL_HIGH');
}

function paramValue(step: Extract<Step, { type: 'action' }>, name: string): string | undefined {
  const value = step.params[name];
  return typeof value === 'string' ? value.trim() : value != null ? String(value) : undefined;
}

export function computeRequiredSlots(ir: Partial<SkillIR>): SlotState[] {
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
  ir: Partial<SkillIR>,
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

  const missingConnections = [...neededConnectors].filter((c) => !connectedConnectors.includes(c));

  const deployable =
    missingRequired.length === 0 && missingConnections.length === 0 && (ir.steps?.length ?? 0) > 0;

  return { slots, missingRequired, deployable, missingConnections };
}

export function getNextQuestion(result: CompletenessResult): string | null {
  if (result.missingConnections.length > 0) {
    return `${result.missingConnections.join(', ')} 연결이 필요합니다. 설정에서 연결해주세요.`;
  }
  const next = result.slots.find((s) => !s.filled);
  return next?.question ?? null;
}

export function slotLabel(slot: SlotState): string {
  return slot.label ?? CORE_QUESTIONS[slot.slot]?.label ?? slot.slot;
}
