import type { SkillIR, Step } from '../skill/schema.js';

export type RequirementSlot =
  | 'goal'
  | 'trigger'
  | 'trigger.schedule'
  | 'trigger.timezone'
  | 'source'
  | 'filter'
  | 'action'
  | 'exception'
  | 'approval'
  | 'permission'
  | 'completion'
  | 'slack.channel'
  | 'gmail.account'
  | 'local_file.path'
  | 'rdb.connection'
  | 'report.template'
  | 'ai_decision.schema';

export interface SlotState {
  slot: RequirementSlot;
  filled: boolean;
  value?: string;
  question?: string;
}

export interface CompletenessResult {
  slots: SlotState[];
  missingRequired: RequirementSlot[];
  deployable: boolean;
  missingConnections: string[];
}

function collectCapabilities(steps: Step[]): string[] {
  const caps: string[] = [];
  for (const step of steps) {
    if (step.type === 'action') {
      caps.push(`${step.connector}.${step.action}`);
    }
    if (step.type === 'ai_decision' && step.investigation) {
      caps.push('investigation.read');
    }
  }
  return caps;
}

function hasExternalHigh(steps: Step[]): boolean {
  return steps.some((s) => s.type === 'action' && s.sideEffect === 'EXTERNAL_HIGH');
}

function hasScheduledTrigger(ir: Partial<SkillIR>): boolean {
  return ir.trigger?.type === 'schedule';
}

function hasSlackSend(steps: Step[]): boolean {
  return steps.some((s) => s.type === 'action' && s.connector === 'slack' && s.action === 'message.send');
}

function hasLocalSheet(steps: Step[]): boolean {
  return steps.some((s) => s.type === 'action' && s.connector === 'local_sheet');
}

function hasRdbQuery(steps: Step[]): boolean {
  return steps.some((s) => s.type === 'action' && s.connector === 'rdb');
}

function hasReport(steps: Step[]): boolean {
  return steps.some((s) => s.type === 'action' && s.connector === 'report');
}

function hasAiDecision(steps: Step[]): boolean {
  return steps.some((s) => s.type === 'ai_decision');
}

export function computeRequiredSlots(ir: Partial<SkillIR>): RequirementSlot[] {
  const required: RequirementSlot[] = ['goal'];
  const steps = ir.steps ?? [];

  if (!ir.trigger) required.push('trigger');
  if (hasScheduledTrigger(ir)) {
    required.push('trigger.schedule', 'trigger.timezone');
  }
  if (ir.trigger?.type === 'gmail.new_message') {
    required.push('gmail.account');
  }

  if (steps.length === 0) required.push('action');

  if (hasSlackSend(steps)) required.push('slack.channel');
  if (hasLocalSheet(steps)) required.push('local_file.path');
  if (hasRdbQuery(steps)) required.push('rdb.connection');
  if (hasReport(steps)) required.push('report.template');
  if (hasAiDecision(steps)) required.push('ai_decision.schema');
  if (hasExternalHigh(steps)) required.push('approval');

  if (!ir.success) required.push('completion');

  return required;
}

const SLOT_QUESTIONS: Record<RequirementSlot, string> = {
  goal: '이 업무의 목적을 한 문장으로 말해주세요.',
  trigger: '언제 이 업무를 실행할까요? (예: 새 메일, 매주 금요일)',
  'trigger.schedule': '실행 스케줄을 알려주세요.',
  'trigger.timezone': '시간대는 어디로 할까요?',
  source: '데이터는 어디에서 가져올까요?',
  filter: '어떤 조건의 항목만 처리할까요?',
  action: '실행할 작업을 설명해주세요.',
  exception: '오류가 나면 어떻게 할까요?',
  approval: '누구의 승인이 필요한가요? 어떤 조건에서 승인할까요?',
  permission: '어떤 권한이 필요한가요?',
  completion: '업무가 완료되었다고 볼 조건은 무엇인가요?',
  'slack.channel': 'Slack 채널은 어디인가요?',
  'gmail.account': '어떤 Gmail 계정을 사용할까요?',
  'local_file.path': '파일 경로를 알려주세요.',
  'rdb.connection': '어떤 DB에 연결할까요?',
  'report.template': '어떤 보고서 양식을 사용할까요?',
  'ai_decision.schema': 'AI가 어떤 형태로 결과를 내야 할까요?',
};

function isSlotFilled(slot: RequirementSlot, ir: Partial<SkillIR>): boolean {
  switch (slot) {
    case 'goal':
      return Boolean(ir.goal?.trim());
    case 'trigger':
      return Boolean(ir.trigger);
    case 'trigger.schedule':
      return ir.trigger?.type === 'schedule' && Boolean(ir.trigger.schedule);
    case 'trigger.timezone':
      return ir.trigger?.type === 'schedule' && Boolean(ir.trigger.timezone);
    case 'gmail.account':
      return ir.trigger?.type === 'gmail.new_message' && Boolean(ir.trigger.accountId);
    case 'action':
      return (ir.steps?.length ?? 0) > 0;
    case 'slack.channel':
      return (ir.steps ?? []).some(
        (s) =>
          s.type === 'action' &&
          s.connector === 'slack' &&
          Boolean((s.params as { channel?: string }).channel),
      );
    case 'local_file.path':
      return (ir.steps ?? []).some(
        (s) =>
          s.type === 'action' &&
          s.connector === 'local_sheet' &&
          Boolean((s.params as { path?: string }).path),
      );
    case 'rdb.connection':
      return (ir.steps ?? []).some(
        (s) =>
          s.type === 'action' &&
          s.connector === 'rdb' &&
          Boolean((s.params as { connectionId?: string }).connectionId),
      );
    case 'report.template':
      return (ir.steps ?? []).some(
        (s) =>
          s.type === 'action' &&
          s.connector === 'report' &&
          Boolean((s.params as { template?: string }).template),
      );
    case 'ai_decision.schema':
      return (ir.steps ?? []).every(
        (s) => s.type !== 'ai_decision' || Boolean(s.outputSchema),
      );
    case 'approval':
      if (!hasExternalHigh(ir.steps ?? [])) return true;
      return (ir.steps ?? []).some(
        (s) => s.type === 'human_approval' && s.forActionIds.length > 0,
      );
    case 'completion':
      return Boolean(ir.success?.trim());
    default:
      return true;
  }
}

export function assessCompleteness(
  ir: Partial<SkillIR>,
  connectedConnectors: string[] = [],
): CompletenessResult {
  const required = computeRequiredSlots(ir);
  const slots: SlotState[] = required.map((slot) => ({
    slot,
    filled: isSlotFilled(slot, ir),
    question: SLOT_QUESTIONS[slot],
  }));

  const missingRequired = slots.filter((s) => !s.filled).map((s) => s.slot);

  const neededConnectors = new Set<string>();
  for (const step of ir.steps ?? []) {
    if (step.type === 'action') neededConnectors.add(step.connector);
  }
  if (ir.trigger?.type === 'gmail.new_message') neededConnectors.add('gmail');

  const missingConnections = [...neededConnectors].filter((c) => !connectedConnectors.includes(c));

  const deployable =
    missingRequired.length === 0 &&
    missingConnections.length === 0 &&
    (ir.steps?.length ?? 0) > 0;

  return { slots, missingRequired, deployable, missingConnections };
}

export function getNextQuestion(result: CompletenessResult): string | null {
  if (result.missingConnections.length > 0) {
    return `${result.missingConnections.join(', ')} 연결이 필요합니다. 설정에서 연결해주세요.`;
  }
  const next = result.slots.find((s) => !s.filled);
  return next?.question ?? null;
}
