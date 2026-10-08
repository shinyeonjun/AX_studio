import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { WorkflowIR } from '../../../../../workflow/schema.js';
import {
  AxRepairApplyArgsSchema,
  AxUiPresentationSchema,
  AxWorkflowDeleteArgsSchema,
  AxWorkflowRunArgsSchema,
  AxWorkflowUpdateArgsSchema,
  type AxCommand,
  type AxCommandName,
  type AxCommandResult,
  type AxUiPresentation,
} from '../../schema.js';
import { issue, result } from '../../contract.js';
import { previewWorkflowUpdate } from '../../workflow-gateway/mutations.js';
import { workflowHasExternalSteps, workflowStepItems, type TargetLabels } from '../../job-registration/presentation.js';
import { httpEndpointsFromConnections } from '../../../../../connectors/http/connection.js';
import { resolveCapability } from '../../../../../catalog/capability-graph.js';
import type { RepairCandidateOperation } from '../../../../../workflow/repair.js';
import type { AxCommandExecuteOptions, AxCommandServiceState } from '../contracts.js';

export type ConfirmedMutationName = 'workflow.run' | 'workflow.update' | 'workflow.delete' | 'repair.apply';

/** Fixed user-visible replies sent by the host-rendered confirm_mutation action. */
export const MUTATION_CONFIRM_VALUES: Readonly<Record<ConfirmedMutationName, string>> = {
  'workflow.run': '이 업무를 지금 실행할게요',
  'workflow.update': '이 업무 변경을 적용할게요',
  'workflow.delete': '이 업무를 삭제할게요',
  'repair.apply': '이 수정안을 적용할게요',
};

const CONFIRM_LABELS: Readonly<Record<ConfirmedMutationName, string>> = {
  'workflow.run': '지금 실행',
  'workflow.update': '변경 적용',
  'workflow.delete': '삭제 확인',
  'repair.apply': '수정안 적용',
};

const TITLES: Readonly<Record<ConfirmedMutationName, string>> = {
  'workflow.run': '이 업무를 지금 실행할까요?',
  'workflow.update': '이 변경을 적용할까요?',
  'workflow.delete': '이 업무를 삭제할까요?',
  'repair.apply': '이 수정안을 적용할까요?',
};

const PENDING_MUTATION_TTL_MS = 15 * 60 * 1000;
const MAX_LABEL_CHARS = 200;
const MutationCommitArgsSchema = z.object({}).strict();


/**
 * Option objects created by mutation.commit after a verified host confirmation.
 * Module-private, so no caller can mark its own options as confirmed.
 */
const confirmedExecutions = new WeakSet<AxCommandExecuteOptions>();

function isConfirmedMutationName(name: AxCommandName): name is ConfirmedMutationName {
  return Object.hasOwn(MUTATION_CONFIRM_VALUES, name);
}

/** Agent-originated mutations wait for an explicit host confirmation instead of executing on model output. */
export function requiresMutationConfirmation(command: AxCommand, options: AxCommandExecuteOptions): boolean {
  return options.executionContext?.origin === 'agent'
    && isConfirmedMutationName(command.name)
    && !confirmedExecutions.has(options);
}

function bounded(value: string, max = MAX_LABEL_CHARS): string {
  const trimmed = value.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max)}…` : trimmed;
}

/**
 * The job as people know it: its name. Ids and version numbers are internal, except that a short
 * id tells apart jobs that share a name, so the card always names exactly one job.
 */
function workflowLabel(store: AxCommandServiceState['store'], workflow: Pick<WorkflowIR, 'name'>, workflowId: string): string {
  const sameName = store.listWorkflows().filter((entry) => entry.name === workflow.name).length;
  return bounded(sameName > 1 ? `${workflow.name} (#${workflowId.slice(0, 8)})` : workflow.name, 240);
}

/** Connection names for the step list, so no raw connection id reaches the card. */
function stepLabels(store: AxCommandServiceState['store']): TargetLabels {
  return {
    connectionId: Object.fromEntries(httpEndpointsFromConnections(store.getConnections())
      .map((endpoint) => [endpoint.id, endpoint.label ?? endpoint.id])),
    column: store.getColumnLabels(),
  };
}

const SET_PATH_LABELS: Record<string, string> = {
  name: '업무 이름', goal: '업무 목적', trigger: '시작 조건', success: '완료 조건', assumptions: '가정',
};

type UpdateOperation = z.infer<typeof AxWorkflowUpdateArgsSchema>['operations'][number];
type AnyStep = { type: string; id?: string; connector?: string; action?: string; params?: Record<string, unknown> };

function stepKindLabel(step: AnyStep): string {
  if (step.type === 'action') {
    return (step.connector && step.action ? resolveCapability(step.connector, step.action)?.label : undefined) ?? '작업';
  }
  if (step.type === 'ai_decision') return 'AI 판단';
  if (step.type === 'human_approval') return '승인 받기';
  return '조건 분기';
}

/** "2단계 '받는 사람' 변경", "2단계 삭제", "새 단계 추가: Slack 메시지" — step numbers and field labels, never ids. */
function describeUpdateOperation(operation: UpdateOperation, current: WorkflowIR, next: WorkflowIR): string {
  if (operation.op === 'set') return `${SET_PATH_LABELS[operation.path] ?? '업무 설정'} 변경`;
  const currentIndex = current.steps.findIndex((step) =>
    step.id === (operation.op === 'remove_step' ? operation.stepId : operation.step.id));
  if (operation.op === 'remove_step') return currentIndex >= 0 ? `${currentIndex + 1}단계 삭제` : '단계 삭제';
  const step = operation.step as AnyStep;
  if (currentIndex < 0) {
    const nextIndex = next.steps.findIndex((candidate) => candidate.id === step.id);
    return `새 단계 추가${nextIndex >= 0 ? ` (${nextIndex + 1}단계)` : ''}: ${stepKindLabel(step)}`;
  }
  const before = current.steps[currentIndex] as AnyStep;
  if (before.type === 'action' && step.type === 'action'
    && before.connector === step.connector && before.action === step.action) {
    const params = (step.connector && step.action ? resolveCapability(step.connector, step.action)?.params : undefined) ?? [];
    const changed = [...new Set([...Object.keys(before.params ?? {}), ...Object.keys(step.params ?? {})])]
      .filter((key) => JSON.stringify(before.params?.[key]) !== JSON.stringify(step.params?.[key]))
      .map((key) => params.find((param) => param.name === key)?.label)
      .filter((label): label is string => Boolean(label));
    if (changed.length > 0) return `${currentIndex + 1}단계 ${[...new Set(changed)].map((label) => `'${label}'`).join(', ')} 변경`;
  }
  return `${currentIndex + 1}단계 수정: ${stepKindLabel(step)}`;
}

function repairCandidateLabel(candidate: RepairCandidateOperation): string {
  return `수정안 적용: '${candidate.from}' 열 대신 '${candidate.to}' 열을 읽습니다`;
}

type Preview =
  | { ok: true; workflowId?: string; blocks: AxUiPresentation['blocks'] }
  | { ok: false; result: AxCommandResult };

function failed(command: AxCommand, tuple: [AxCommandResult['status'], unknown, AxCommandResult['issues']?]): Preview {
  return { ok: false, result: result(command.name, tuple[0], tuple[1], tuple[2] ?? []) };
}

function previewMutation(state: AxCommandServiceState, command: AxCommand, name: ConfirmedMutationName): Preview {
  const store = state.store;
  if (name === 'workflow.update') {
    const preview = previewWorkflowUpdate(store, command);
    if (!preview.ok) return failed(command, preview.result);
    const { workflowId, current, next, executableChange } = preview.value;
    const operations = AxWorkflowUpdateArgsSchema.parse(command.args).operations
      .map((operation) => describeUpdateOperation(operation, current, next));
    return {
      ok: true,
      workflowId,
      blocks: [
        { type: 'decision', label: '대상 업무', value: workflowLabel(store, current, workflowId) },
        { type: 'steps', title: '요청한 변경', items: operations.slice(0, 20).map((item) => bounded(item, 500)) },
        ...(next.steps.length > 0
          ? [{ type: 'steps' as const, title: '변경 후 단계별 연결·동작·대상', items: workflowStepItems(next, stepLabels(store)) }]
          : []),
        {
          type: 'note',
          text: executableChange
            ? '실행 내용이 바뀌므로 자동 발송은 꺼지고, 활성 업무는 다시 켜기 전까지 중지됩니다. 확인 전에는 아무것도 저장하지 않았습니다.'
            : '확인 전에는 아무것도 저장하지 않았습니다.',
        },
      ],
    };
  }
  if (name === 'workflow.delete' || name === 'workflow.run') {
    const parsed = (name === 'workflow.delete' ? AxWorkflowDeleteArgsSchema : AxWorkflowRunArgsSchema).safeParse(command.args);
    if (!parsed.success) return failed(command, ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]]);
    const workflowId = parsed.data.workflowId;
    const workflow = store.getWorkflow(workflowId);
    if (!workflow) {
      return failed(command, ['not_found', undefined, [issue('workflow_not_found', '해당 업무를 찾지 못했습니다. 이미 삭제되었는지 확인해 주세요.', 'args.workflowId')]]);
    }
    if (name === 'workflow.delete') {
      const baseVersion = (parsed.data as z.infer<typeof AxWorkflowDeleteArgsSchema>).baseVersion;
      if (workflow.version !== baseVersion) {
        return failed(command, ['conflict', { currentVersion: workflow.version }, [issue('stale_workflow_version', '그사이 업무가 바뀌었어요. 새로고침한 뒤 다시 시도해 주세요.', 'baseVersion')]]);
      }
      return {
        ok: true,
        workflowId,
        blocks: [
          { type: 'decision', label: '삭제할 업무', value: workflowLabel(store, workflow, workflowId) },
          { type: 'note', text: '삭제하면 저장된 업무와 시작 조건이 제거되며 되돌릴 수 없습니다. 확인 전에는 아무것도 삭제하지 않았습니다.' },
        ],
      };
    }
    return {
      ok: true,
      workflowId,
      blocks: [
        { type: 'decision', label: '실행할 업무', value: workflowLabel(store, workflow, workflowId) },
        ...(workflow.steps.length > 0
          ? [{ type: 'steps' as const, title: '단계별 연결·동작·대상', items: workflowStepItems(workflow, stepLabels(store)) }]
          : []),
        {
          type: 'note',
          text: !workflowHasExternalSteps(workflow)
            ? '외부 전송 단계가 없습니다. 확인 전에는 실행하지 않았습니다.'
            : workflow.allowExternalAuto
              ? '자동 발송이 켜져 있어 [외부] 단계는 승인 없이 보냅니다. 고위험 단계는 계속 승인을 받습니다.'
              : '[외부] 단계는 보내기 전에 승인을 받습니다. 확인 전에는 실행하지 않았습니다.',
        },
      ],
    };
  }
  const parsed = AxRepairApplyArgsSchema.safeParse(command.args);
  if (!parsed.success) return failed(command, ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]]);
  const proposal = store.getRepairProposal(parsed.data.repairId);
  if (!proposal) return failed(command, ['not_found', undefined, [issue('repair_not_found', '수정안을 찾지 못했습니다. 이미 처리되었는지 확인해 주세요.', 'args.repairId')]]);
  if (proposal.status !== 'proposed') {
    return failed(command, ['conflict', { status: proposal.status }, [issue('repair_not_proposed', '이미 처리된 수정안은 다시 적용할 수 없습니다.')]]);
  }
  if (!proposal.candidates.some((entry) => entry.id === parsed.data.candidateId)) {
    return failed(command, ['not_found', undefined, [issue('repair_candidate_not_found', '고른 수정안을 찾지 못했습니다. 다시 요청해 주세요.', 'args.candidateId')]]);
  }
  const workflow = store.getWorkflow(proposal.workflowId);
  return {
    ok: true,
    workflowId: proposal.workflowId,
    blocks: [
      {
        type: 'decision',
        label: '대상 업무',
        value: workflow
          ? workflowLabel(store, workflow, proposal.workflowId)
          : '삭제되었거나 찾을 수 없는 업무',
      },
      { type: 'decision', label: '수정안', value: bounded(repairCandidateLabel(proposal.candidates.find((entry) => entry.id === parsed.data.candidateId)!), 240) },
      { type: 'note', text: '예전 실행 결과로 다시 확인해 모두 맞을 때만 적용합니다. 확인 전에는 적용하지 않았습니다.' },
    ],
  };
}

function prunePendingMutations(state: AxCommandServiceState, now: number): void {
  for (const [sessionId, entry] of state.pendingMutations) {
    if (now - entry.createdAt > PENDING_MUTATION_TTL_MS) state.pendingMutations.delete(sessionId);
  }
}

/** Stores the exact proposed mutation and returns a host-rendered confirmation card instead of executing it. */
export function requestMutationConfirmation(
  state: AxCommandServiceState,
  command: AxCommand,
  options: AxCommandExecuteOptions,
): AxCommandResult {
  if (!isConfirmedMutationName(command.name)) throw new Error('Unsupported confirmed mutation: ' + command.name);
  const name = command.name;
  const sessionId = options.workspaceSessionId?.trim();
  if (!sessionId) {
    return result(command.name, 'forbidden', undefined, [issue(
      'workspace_session_required',
      '이 변경은 현재 대화의 확인 카드로만 실행할 수 있습니다. 대화를 찾지 못해 실행하지 않았습니다.',
    )]);
  }
  const preview = previewMutation(state, command, name);
  if (!preview.ok) return preview.result;

  const now = Date.now();
  prunePendingMutations(state, now);
  const token = randomUUID();
  state.pendingMutations.set(sessionId, {
    token,
    command: structuredClone(command),
    ...(preview.workflowId ? { workflowId: preview.workflowId } : {}),
    createdAt: now,
  });
  const presentation = AxUiPresentationSchema.parse({
    title: TITLES[name],
    inputMode: 'individual',
    blocks: preview.blocks,
    inputs: [],
    actions: [{
      id: `confirm_mutation:${token}`,
      label: CONFIRM_LABELS[name],
      value: MUTATION_CONFIRM_VALUES[name],
      tone: name === 'workflow.delete' ? 'danger' : 'primary',
      purpose: 'confirm_mutation',
    }],
  });
  return result(command.name, 'needs_input', {
    confirmationRequired: true,
    pending: true,
    presentation,
    message: `${TITLES[name]} 확인 카드에서 승인하기 전에는 실행하지 않습니다.`,
  });
}

/**
 * Executes the exact host-stored mutation once, only for the matching
 * host-rendered confirmation token. Returns the underlying command's result.
 */
export async function commitPendingMutation(
  state: AxCommandServiceState,
  command: AxCommand,
  options: AxCommandExecuteOptions,
  execute: (state: AxCommandServiceState, command: AxCommand, options: AxCommandExecuteOptions) => Promise<AxCommandResult>,
): Promise<AxCommandResult> {
  if (!MutationCommitArgsSchema.safeParse(command.args).success) {
    return result(command.name, 'invalid', undefined, [issue('invalid_arguments', '요청을 처리하지 못했습니다. 다시 시도해 주세요.')]);
  }
  const token = options.mutationConfirmationToken?.trim();
  if (!token) {
    return result(command.name, 'forbidden', undefined, [issue(
      'mutation_commit_forbidden',
      '이 변경은 확인 카드에서 확인한 뒤에만 실행할 수 있습니다.',
    )]);
  }
  const sessionId = options.workspaceSessionId?.trim();
  if (!sessionId) {
    return result(command.name, 'invalid', undefined, [issue('workspace_session_required', '확인한 변경은 대화 안에서만 실행할 수 있습니다.')]);
  }
  const pending = state.pendingMutations.get(sessionId);
  if (!pending || Date.now() - pending.createdAt > PENDING_MUTATION_TTL_MS) {
    if (pending) state.pendingMutations.delete(sessionId);
    return result(command.name, 'not_found', undefined, [issue(
      'pending_mutation_not_found',
      '확인할 변경을 찾지 못했습니다. 오래되었거나 이미 처리되었을 수 있으니 다시 요청해 주세요.',
    )]);
  }
  if (pending.token !== token) {
    return result(command.name, 'forbidden', undefined, [issue(
      'mutation_confirmation_mismatch',
      '현재 확인 카드는 대기 중인 변경에 대한 확인이 아닙니다. 다시 요청한 뒤 확인해 주세요.',
    )]);
  }
  const currentWorkflowId = options.currentWorkflowId?.trim();
  if (currentWorkflowId && pending.workflowId && pending.workflowId !== currentWorkflowId) {
    return result(command.name, 'forbidden', undefined, [issue(
      'workflow_target_mismatch',
      '확인한 변경의 업무가 현재 대화의 업무와 다릅니다. 해당 업무에서 다시 요청해 주세요.',
    )]);
  }
  // One-shot: consume before executing so a retry or replay cannot run it twice.
  state.pendingMutations.delete(sessionId);
  const confirmedOptions: AxCommandExecuteOptions = { ...options, mutationConfirmationToken: undefined };
  confirmedExecutions.add(confirmedOptions);
  return execute(state, pending.command, confirmedOptions);
}
