import type {
  AxInputRequest,
  AxUiPresentation,
} from '../schema.js';
import {
  JOB_COMMIT_CONFIRM_VALUE,
  type NormalizedJobSpec,
} from './contract.js';
import type { SideEffectLevel, WorkflowIR } from '../../../../workflow/schema.js';
import { actionRefFor, resolveActionDefinition } from '../../../../workflow/action-definition.js';
import { resolveEffectiveSideEffect } from '../../../../workflow/side-effect-resolve.js';

const MAX_STEP_ITEMS = 20;
const MAX_ITEM_CHARS = 500;
const MAX_TARGET_VALUE_CHARS = 160;
/** Params that name where data goes or comes from; shown so the human sees exact destinations. */
const TARGET_PARAM_KEYS = [
  'connectionId', 'method', 'url', 'path', 'channel', 'to', 'cc', 'bcc', 'recipient', 'recipients',
  'accountId', 'folderId', 'table', 'threadTs', 'subject',
] as const;
const SIDE_EFFECT_LABEL: Record<SideEffectLevel, string> = {
  NONE: '부작용 없음(조회)',
  REVERSIBLE: '되돌릴 수 있는 변경',
  EXTERNAL: '외부 전송',
  EXTERNAL_HIGH: '외부 전송(고위험)',
};

type WorkflowActionStep = Extract<WorkflowIR['steps'][number], { type: 'action' }>;

/** Unknown actions are treated as external so the card never understates risk. */
function workflowStepSideEffect(workflow: Pick<WorkflowIR, 'sideEffects'>, step: WorkflowActionStep): SideEffectLevel {
  const override = workflow.sideEffects?.[step.id] ?? step.sideEffect;
  const definition = resolveActionDefinition(step.actionRef ?? actionRefFor(step.connector, step.action));
  if (!definition) return override ?? 'EXTERNAL';
  return resolveEffectiveSideEffect(definition, step.params ?? {}, override);
}

function isExternalSideEffect(level: SideEffectLevel): boolean {
  return level === 'EXTERNAL' || level === 'EXTERNAL_HIGH';
}

export function workflowHasExternalSteps(workflow: Pick<WorkflowIR, 'steps' | 'sideEffects'>): boolean {
  return workflow.steps.some((step) => step.type === 'action' && isExternalSideEffect(workflowStepSideEffect(workflow, step)));
}

function boundedValue(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    return trimmed.length > MAX_TARGET_VALUE_CHARS ? `${trimmed.slice(0, MAX_TARGET_VALUE_CHARS)}…` : trimmed;
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) {
    const parts = value.map(boundedValue).filter((part): part is string => Boolean(part));
    return parts.length > 0 ? boundedValue(parts.join(', ')) : undefined;
  }
  return undefined;
}

function stepTargets(step: WorkflowActionStep, connectionLabels: Readonly<Record<string, string>>): string {
  const params = step.params ?? {};
  const targets: string[] = [];
  for (const key of TARGET_PARAM_KEYS) {
    if (Object.hasOwn(params, key)) {
      const value = boundedValue(params[key]);
      if (!value) continue;
      const label = key === 'connectionId' ? connectionLabels[value] : undefined;
      targets.push(`${key}=${label ? `${label} (${value})` : value}`);
    } else if (step.bindings && Object.hasOwn(step.bindings, key)) {
      const binding = step.bindings[key] as { from?: unknown; output?: unknown } | undefined;
      targets.push(`${key}=실행 중 ${String(binding?.from ?? '?')}.${String(binding?.output ?? '?')} 값`);
    }
  }
  return targets.length > 0 ? targets.join(', ') : '지정된 대상 없음';
}

/** One line per step: connector, action, side-effect level and resolved destinations. */
export function workflowStepItems(
  workflow: Pick<WorkflowIR, 'steps' | 'sideEffects'>,
  connectionLabels: Readonly<Record<string, string>> = {},
): string[] {
  const items = workflow.steps.map((step) => {
    if (step.type === 'action') {
      const sideEffect = workflowStepSideEffect(workflow, step);
      const marker = isExternalSideEffect(sideEffect) ? '[외부] ' : '';
      return `${marker}${step.id}: ${step.connector} / ${step.action} · ${SIDE_EFFECT_LABEL[sideEffect]} · 대상: ${stepTargets(step, connectionLabels)}`;
    }
    if (step.type === 'ai_decision') return `${step.id}: AI 판단 · 외부 부작용 없음`;
    if (step.type === 'human_approval') return `${step.id}: 사람 승인 단계`;
    return `${step.id}: 조건 분기`;
  }).map((item) => item.slice(0, MAX_ITEM_CHARS));
  if (items.length <= MAX_STEP_ITEMS) return items;
  return [...items.slice(0, MAX_STEP_ITEMS - 1), `외 ${items.length - (MAX_STEP_ITEMS - 1)}개 단계 (전체 내용은 workflow 화면에서 확인)`];
}

function autoSendNote(allowExternalAuto: boolean, hasExternal: boolean): string {
  if (!hasExternal) return '외부 전송 단계가 없습니다.';
  return allowExternalAuto
    ? '자동 발송(별도 선택): 켜짐 — 확인하면 이후 실행에서 [외부] 표시 단계가 실행마다 승인 없이 전송될 수 있습니다. 고위험 단계는 계속 승인이 필요합니다.'
    : '자동 발송: 꺼짐(기본) — [외부] 표시 단계는 실행마다 승인이 필요합니다.';
}

function runNote(runOnceNow: boolean, hasExternal: boolean): string {
  if (!runOnceNow) return '지금은 실행하지 않고 시작 조건만 켭니다.';
  return hasExternal
    ? '저장 직후 한 번 실행합니다. [외부] 단계는 승인 정책에 따라 처리됩니다.'
    : '저장 직후 한 번 실행합니다.';
}

export function targetSelectionPresentation(
  inputs: AxInputRequest[],
  options: {
    actionId?: string;
    actionLabel?: string;
    actionValue?: string;
    note?: string;
  } = {},
): AxUiPresentation {
  return {
    title: '공유 대상 선택',
    subtitle: '조회와 공유에 사용할 대상을 한 번에 선택해 주세요.',
    inputMode: 'batch',
    blocks: [{
      type: 'note',
      text: options.note ?? '선택 후 조회·요약한 공유안을 먼저 보여드립니다. 실제 외부 발송은 별도 승인 전까지 실행하지 않습니다.',
    }],
    inputs,
    actions: [{
      id: options.actionId ?? 'review_job_targets',
      label: options.actionLabel ?? '선택하고 공유안 검토',
      value: options.actionValue ?? '선택한 연결과 채널로 공유안을 검토해줘',
      tone: 'primary',
      purpose: 'reply',
    }],
  };
}

export function confirmationPresentation(
  spec: NormalizedJobSpec,
  workflow: Pick<WorkflowIR, 'steps' | 'sideEffects'>,
  httpLabel?: string,
  confirmationToken?: string,
): AxUiPresentation {
  const hasExternal = workflowHasExternalSteps(workflow);
  return {
    title: '이 업무를 저장할까요?',
    subtitle: spec.name,
    inputMode: 'individual',
    blocks: [
      {
        type: 'steps',
        title: '등록 내용',
        items: [
          `스케줄: ${spec.cron} (${spec.timezone})`,
          runNote(spec.runOnceNow, hasExternal),
        ],
      },
      {
        type: 'steps',
        title: '단계별 연결·동작·대상',
        items: workflowStepItems(workflow, httpLabel ? { [spec.connectionId]: httpLabel } : {}),
      },
      { type: 'note', text: autoSendNote(spec.allowExternalAuto, hasExternal) },
    ],
    inputs: [],
    actions: [
      {
        id: confirmationToken ? `confirm_job:${confirmationToken}` : 'confirm_job',
        label: '저장하고 켜기',
        value: JOB_COMMIT_CONFIRM_VALUE,
        tone: 'primary',
        purpose: 'confirm_job',
      },
    ],
  };
}

function triggerSummary(trigger: WorkflowIR['trigger']): string {
  if (!trigger) return '수동 시작';
  if (trigger.type === 'schedule') return `스케줄: ${trigger.schedule} (${trigger.timezone})`;
  if (trigger.type === 'gmail.new_message') return `Gmail 새 메일: ${trigger.accountId}`;
  if (trigger.type === 'slack.new_message') return `Slack 새 메시지: ${trigger.channel}`;
  if (trigger.type === 'local_folder.new_file') return `폴더 새 파일: ${trigger.folderId}`;
  if (trigger.type === 'once') return `일회 실행: ${trigger.runAt}`;
  if (trigger.type === 'webhook.inbound') return `Webhook: ${trigger.path}`;
  return '수동 시작';
}

export function workflowConfirmationPresentation(
  workflow: WorkflowIR,
  runOnceNow: boolean,
  allowExternalAuto: boolean,
  confirmationToken?: string,
): AxUiPresentation {
  const hasExternal = workflowHasExternalSteps(workflow);
  return {
    title: '이 업무를 저장할까요?',
    subtitle: workflow.name,
    inputMode: 'individual',
    blocks: [
      {
        type: 'steps',
        title: '등록 내용',
        items: [
          triggerSummary(workflow.trigger),
          runNote(runOnceNow, hasExternal),
        ],
      },
      {
        type: 'steps',
        title: '단계별 연결·동작·대상',
        items: workflow.steps.length > 0 ? workflowStepItems(workflow) : ['단계 없음'],
      },
      { type: 'note', text: autoSendNote(allowExternalAuto, hasExternal) },
    ],
    inputs: [],
    actions: [{
      id: confirmationToken ? `confirm_job:${confirmationToken}` : 'confirm_job',
      label: '저장하고 켜기',
      value: JOB_COMMIT_CONFIRM_VALUE,
      tone: 'primary',
      purpose: 'confirm_job',
    }],
  };
}
