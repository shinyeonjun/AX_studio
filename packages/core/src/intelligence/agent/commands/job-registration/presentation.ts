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
import { describeSchedule, formatRunTime, nextRunSentence, type ScheduleLike } from '../../../../workflow/schedule/describe.js';
import { describeShaping } from '../../../../workflow/transform-expr/describe.js';
import { resolveCapability } from '../../../../catalog/capability-graph.js';
import { TransformExprSchema } from '../../../../workflow/transform-expr/dsl.js';

const MAX_STEP_ITEMS = 20;
const MAX_ITEM_CHARS = 500;
const MAX_TARGET_VALUE_CHARS = 160;
/** Params that name where data goes or comes from; shown so the human sees exact destinations. */
const TARGET_PARAM_KEYS = [
  'connectionId', 'method', 'url', 'path', 'channel', 'to', 'cc', 'bcc', 'recipient', 'recipients',
  'accountId', 'folderId', 'table', 'threadTs', 'subject',
] as const;
const TARGET_KEY_LABEL: Record<string, string> = {
  connectionId: '연결', method: '방식', url: 'URL', path: '경로', channel: '채널', to: '받는 사람',
  cc: '참조', bcc: '숨은 참조', recipient: '받는 사람', recipients: '받는 사람', accountId: '계정',
  folderId: '폴더', table: '테이블', threadTs: '스레드', subject: '제목',
};
const SIDE_EFFECT_LABEL: Record<SideEffectLevel, string> = {
  NONE: '읽기만 함',
  REVERSIBLE: '되돌릴 수 있는 변경',
  EXTERNAL: '외부 전송',
  EXTERNAL_HIGH: '외부 전송(고위험)',
};

/**
 * Display names for internal ids, per target parameter: `{ connectionId: { conn_1: 'DummyJSON' },
 * channel: { C0123: '#ops' } }`. Ids without a name are shown as they are.
 */
export type TargetLabels = Readonly<Partial<Record<string, Readonly<Record<string, string>>>>>;

function labelFor(labels: TargetLabels, key: string, value: string): string | undefined {
  const byValue = labels[key];
  return byValue && Object.hasOwn(byValue, value) ? byValue[value] : undefined;
}

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

function stepTargets(
  step: WorkflowActionStep,
  labels: TargetLabels,
  stepNumbers: ReadonlyMap<string, number>,
): string {
  const params = step.params ?? {};
  const targets: string[] = [];
  for (const key of TARGET_PARAM_KEYS) {
    const name = TARGET_KEY_LABEL[key] ?? key;
    if (Object.hasOwn(params, key)) {
      const value = boundedValue(params[key]);
      if (!value) continue;
      // Show the connection's or channel's name; a raw id means nothing to the user.
      targets.push(`${name} ${labelFor(labels, key, value) ?? value}`);
    } else if (step.bindings && Object.hasOwn(step.bindings, key)) {
      const binding = step.bindings[key] as { from?: unknown; output?: unknown } | undefined;
      const from = typeof binding?.from === 'string' ? stepNumbers.get(binding.from) : undefined;
      targets.push(`${name} ${from ? `${from}단계 결과` : '실행 중 정해지는 값'}`);
    }
  }
  // A database read that brings each row's matching rows from other tables names them too.
  if (Array.isArray(params.join)) {
    const joined = params.join.flatMap((join) => (join && typeof join === 'object' && typeof (join as { table?: unknown }).table === 'string'
      ? [boundedValue((join as { table: string }).table)] : [])).filter(Boolean);
    if (joined.length > 0) targets.push(`함께 읽는 테이블 ${joined.join(', ')}`);
  }
  if (targets.length > 0) return targets.join(', ');
  // No destination of its own: say where its input comes from (the mail that started the run).
  const sources = Object.values(step.bindings ?? {}).map((binding) => (binding as { from?: unknown }).from);
  if (sources.includes('trigger')) return '시작 조건으로 들어온 항목';
  const fromSteps = sources.flatMap((from) => (typeof from === 'string' && stepNumbers.has(from) ? [stepNumbers.get(from)!] : []));
  return fromSteps.length > 0 ? `${[...new Set(fromSteps)].join('·')}단계 결과` : '지정된 대상 없음';
}

/** Built-in table steps described by what they do; they have no destination to show. */
function tableStepItem(step: WorkflowActionStep, stepNumbers: ReadonlyMap<string, number>, labels: TargetLabels): string | undefined {
  if (step.connector !== 'transform') return undefined;
  const inputs = Object.values(step.bindings ?? {})
    .map((binding) => stepNumbers.get((binding as { from?: string }).from ?? ''))
    .filter((value): value is number => value !== undefined);
  const using = inputs.length > 0 ? ` (${inputs.join('·')}단계 결과 사용)` : '';
  if (step.action === 'http_to_table') return `응답을 표로 변환${using} · 읽기만 함`;
  if (step.action === 'evaluate') {
    const expr = TransformExprSchema.safeParse(step.params?.expr);
    return `표 정리${using} · 읽기만 함 · ${expr.success ? describeShaping(expr.data, (column) => labelFor(labels, 'column', column) ?? column) : '변환식 확인 필요'}`;
  }
  return undefined;
}

/** One line per step: connector, action, side-effect level and resolved destinations. */
export function workflowStepItems(
  workflow: Pick<WorkflowIR, 'steps' | 'sideEffects'>,
  labels: TargetLabels = {},
): string[] {
  const stepNumbers = new Map(workflow.steps.map((step, index) => [step.id, index + 1]));
  // The card numbers the list itself; an item says what its step does.
  const items = workflow.steps.map((step) => {
    if (step.type === 'action') {
      const tableItem = tableStepItem(step, stepNumbers, labels);
      if (tableItem) return tableItem;
      const sideEffect = workflowStepSideEffect(workflow, step);
      const marker = isExternalSideEffect(sideEffect) ? '[외부] ' : '';
      // What the step does in words ("DB 조회"), not its connector/action ids.
      const action = resolveCapability(step.connector, step.action)?.label ?? `${step.connector} / ${step.action}`;
      return `${marker}${action} · ${SIDE_EFFECT_LABEL[sideEffect]} · 대상: ${stepTargets(step, labels, stepNumbers)}`;
    }
    if (step.type === 'ai_decision') {
      const inputs = Object.values(step.bindings ?? {}).map((binding) => stepNumbers.get((binding as { from?: string }).from ?? ''))
        .filter((value): value is number => value !== undefined);
      return `AI 문안 작성${inputs.length ? ` (${inputs.join('·')}단계 결과 사용)` : ''} · 밖으로 보내지 않음`;
    }
    if (step.type === 'human_approval') return '승인 받기';
    return '조건 분기';
  }).map((item) => item.slice(0, MAX_ITEM_CHARS));
  if (items.length <= MAX_STEP_ITEMS) return items;
  return [...items.slice(0, MAX_STEP_ITEMS - 1), `외 ${items.length - (MAX_STEP_ITEMS - 1)}개 단계 (전체 내용은 업무 화면에서 확인)`];
}

function autoSendNote(allowExternalAuto: boolean, hasExternal: boolean): string {
  if (!hasExternal) return '외부 전송 단계가 없습니다.';
  return allowExternalAuto
    ? '자동 발송: 켜짐 — [외부] 단계는 승인 없이 보냅니다. 고위험 단계는 계속 승인을 받습니다.'
    : '자동 발송: 꺼짐 — [외부] 단계는 보낼 때마다 승인을 받습니다.';
}

/** Plain-Korean schedule plus a preview of the next actual runs, so the user confirms real dates. */
function scheduleItems(schedule: ScheduleLike): string[] {
  const preview = nextRunSentence(schedule, { count: 3 });
  return [`일정: ${describeSchedule(schedule) || '미정'}`, ...(preview ? [preview] : [])]
    .map((item) => item.slice(0, MAX_ITEM_CHARS));
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
  channelLabels: Readonly<Record<string, string>> = {},
  columnLabels: Readonly<Record<string, string>> = {},
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
          ...scheduleItems({ schedule: spec.cron, timezone: spec.timezone }),
          runNote(spec.runOnceNow, hasExternal),
        ],
      },
      {
        type: 'steps',
        title: '단계별 연결·동작·대상',
        items: workflowStepItems(workflow, {
          connectionId: httpLabel ? { [spec.connectionId]: httpLabel } : {},
          channel: channelLabels,
          column: columnLabels,
        }),
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

function triggerSummary(trigger: WorkflowIR['trigger'], labels: TargetLabels): string[] {
  if (trigger?.type === 'schedule') return scheduleItems(trigger);
  return [triggerLabel(trigger, labels)];
}

function triggerLabel(trigger: WorkflowIR['trigger'], labels: TargetLabels): string {
  if (!trigger) return '직접 실행';
  if (trigger.type === 'gmail.new_message') {
    const account = labelFor(labels, 'accountId', trigger.accountId)
      ?? (trigger.accountId.includes('@') ? trigger.accountId : undefined);
    return account ? `Gmail 새 메일: ${account}` : 'Gmail에 새 메일이 오면';
  }
  if (trigger.type === 'slack.new_message') return `Slack 새 메시지: ${labelFor(labels, 'channel', trigger.channel) ?? trigger.channel}`;
  if (trigger.type === 'local_folder.new_file') {
    const folder = labelFor(labels, 'folderId', trigger.folderId);
    return folder ? `폴더 새 파일: ${folder}` : '연결한 폴더에 새 파일이 생기면';
  }
  if (trigger.type === 'once') return `한 번 예약: ${onceRunLabel(trigger.runAt)}`;
  if (trigger.type === 'webhook.inbound') return `Webhook: ${trigger.path}`;
  return '직접 실행';
}

/** "10월 8일(수) 오전 10:00" in this computer's time zone; unreadable values stay as written. */
function onceRunLabel(runAt: string): string {
  const instant = new Date(runAt);
  if (Number.isNaN(instant.getTime())) return runAt;
  return formatRunTime(instant, Intl.DateTimeFormat().resolvedOptions().timeZone);
}

export function workflowConfirmationPresentation(
  workflow: WorkflowIR,
  runOnceNow: boolean,
  allowExternalAuto: boolean,
  confirmationToken?: string,
  labels: TargetLabels = {},
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
          ...triggerSummary(workflow.trigger, labels),
          runNote(runOnceNow, hasExternal),
        ],
      },
      {
        type: 'steps',
        title: '단계별 연결·동작·대상',
        items: workflow.steps.length > 0 ? workflowStepItems(workflow, labels) : ['단계 없음'],
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
