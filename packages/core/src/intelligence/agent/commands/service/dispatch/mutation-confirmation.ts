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
import { workflowStepItems } from '../../job-registration/presentation.js';
import type { AxCommandExecuteOptions, AxCommandServiceState } from '../contracts.js';

export type ConfirmedMutationName = 'workflow.run' | 'workflow.update' | 'workflow.delete' | 'repair.apply';

/** Fixed user-visible replies sent by the host-rendered confirm_mutation action. */
export const MUTATION_CONFIRM_VALUES: Readonly<Record<ConfirmedMutationName, string>> = {
  'workflow.run': '현재 workflow를 지금 실행할게요',
  'workflow.update': '이 workflow 변경을 적용할게요',
  'workflow.delete': '현재 workflow를 삭제할게요',
  'repair.apply': '이 repair를 적용할게요',
};

const CONFIRM_LABELS: Readonly<Record<ConfirmedMutationName, string>> = {
  'workflow.run': '지금 실행',
  'workflow.update': '변경 적용',
  'workflow.delete': '삭제 확인',
  'repair.apply': 'repair 적용',
};

const TITLES: Readonly<Record<ConfirmedMutationName, string>> = {
  'workflow.run': '현재 workflow를 지금 실행할까요?',
  'workflow.update': '이 변경을 적용할까요?',
  'workflow.delete': '현재 workflow를 삭제할까요?',
  'repair.apply': 'repair를 적용할까요?',
};

export const PENDING_MUTATION_TTL_MS = 15 * 60 * 1000;
const MAX_PENDING_MUTATIONS = 128;
const MAX_LABEL_CHARS = 200;
const MutationCommitArgsSchema = z.object({}).strict();

export type { PendingMutation } from '../contracts.js';

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

function workflowLabel(workflow: Pick<WorkflowIR, 'name'>, workflowId: string, version?: number): string {
  return bounded(`${workflow.name} (${workflowId})${version === undefined ? '' : ` · 버전 ${version}`}`, 240);
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
    const operations = AxWorkflowUpdateArgsSchema.parse(command.args).operations.map((operation) =>
      operation.op === 'set' ? `필드 변경: ${operation.path}`
        : operation.op === 'remove_step' ? `단계 삭제: ${operation.stepId}`
          : `단계 추가·수정: ${operation.step.id ?? '(id 없음)'}`);
    return {
      ok: true,
      workflowId,
      blocks: [
        { type: 'decision', label: '대상 workflow', value: workflowLabel(current, workflowId, current.version) },
        { type: 'steps', title: '요청한 변경', items: operations.slice(0, 20).map((item) => bounded(item, 500)) },
        ...(next.steps.length > 0
          ? [{ type: 'steps' as const, title: '변경 후 단계별 연결·동작·대상', items: workflowStepItems(next) }]
          : []),
        {
          type: 'note',
          text: executableChange
            ? '실행 내용이 바뀌므로 자동 발송은 꺼지고, 활성 workflow는 다시 켜기 전까지 중지됩니다. 확인 전에는 아무것도 저장하지 않았습니다.'
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
      return failed(command, ['not_found', undefined, [issue('workflow_not_found', `workflow를 찾을 수 없습니다: ${workflowId}`, 'args.workflowId')]]);
    }
    if (name === 'workflow.delete') {
      const baseVersion = (parsed.data as z.infer<typeof AxWorkflowDeleteArgsSchema>).baseVersion;
      if (workflow.version !== baseVersion) {
        return failed(command, ['conflict', { currentVersion: workflow.version }, [issue('stale_workflow_version', '최신 workflow 버전과 일치하지 않습니다.', 'baseVersion')]]);
      }
      return {
        ok: true,
        workflowId,
        blocks: [
          { type: 'decision', label: '삭제할 workflow', value: workflowLabel(workflow, workflowId, workflow.version) },
          { type: 'note', text: '삭제하면 저장된 workflow와 시작 조건이 제거되며 되돌릴 수 없습니다. 확인 전에는 아무것도 삭제하지 않았습니다.' },
        ],
      };
    }
    return {
      ok: true,
      workflowId,
      blocks: [
        { type: 'decision', label: '실행할 workflow', value: workflowLabel(workflow, workflowId, workflow.version) },
        ...(workflow.steps.length > 0
          ? [{ type: 'steps' as const, title: '단계별 연결·동작·대상', items: workflowStepItems(workflow) }]
          : []),
        {
          type: 'note',
          text: workflow.allowExternalAuto
            ? '이 workflow는 자동 발송이 켜져 있어 [외부] 단계가 실행마다 승인 없이 전송될 수 있습니다. 고위험 단계는 계속 승인이 필요합니다.'
            : '[외부] 단계는 실행 중 별도 승인이 필요합니다. 확인 전에는 실행하지 않았습니다.',
        },
      ],
    };
  }
  const parsed = AxRepairApplyArgsSchema.safeParse(command.args);
  if (!parsed.success) return failed(command, ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]]);
  const proposal = store.getRepairProposal(parsed.data.repairId);
  if (!proposal) return failed(command, ['not_found', undefined, [issue('repair_not_found', 'repair 제안을 찾을 수 없습니다.', 'args.repairId')]]);
  if (proposal.status !== 'proposed') {
    return failed(command, ['conflict', { status: proposal.status }, [issue('repair_not_proposed', '이미 처리된 repair 제안은 다시 적용할 수 없습니다.')]]);
  }
  if (!proposal.candidates.some((entry) => entry.id === parsed.data.candidateId)) {
    return failed(command, ['not_found', undefined, [issue('repair_candidate_not_found', 'repair 후보를 찾을 수 없습니다.', 'args.candidateId')]]);
  }
  const workflow = store.getWorkflow(proposal.workflowId);
  return {
    ok: true,
    workflowId: proposal.workflowId,
    blocks: [
      {
        type: 'decision',
        label: '대상 workflow',
        value: workflow
          ? workflowLabel(workflow, proposal.workflowId, parsed.data.baseVersion)
          : bounded(`${proposal.workflowId} · 버전 ${parsed.data.baseVersion}`, 240),
      },
      { type: 'decision', label: 'repair 후보', value: bounded(`${parsed.data.repairId} / ${parsed.data.candidateId}`, 240) },
      { type: 'note', text: '모든 과거 replay가 통과한 경우에만 새 workflow 버전으로 적용됩니다. 확인 전에는 적용하지 않았습니다.' },
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
      '이 변경은 현재 대화의 확인 카드로만 실행할 수 있습니다. 대화 세션이 없어 실행하지 않았습니다.',
    )]);
  }
  const preview = previewMutation(state, command, name);
  if (!preview.ok) return preview.result;

  const now = Date.now();
  prunePendingMutations(state, now);
  if (!state.pendingMutations.has(sessionId) && state.pendingMutations.size >= MAX_PENDING_MUTATIONS) {
    return result(command.name, 'invalid', undefined, [issue(
      'pending_mutations_full',
      '확인 대기 중인 변경이 많습니다. 기존 확인 카드를 처리한 뒤 다시 시도해 주세요.',
    )]);
  }
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
    return result(command.name, 'invalid', undefined, [issue('invalid_arguments', 'mutation.commit은 인자를 받지 않습니다.')]);
  }
  const token = options.mutationConfirmationToken?.trim();
  if (!token) {
    return result(command.name, 'forbidden', undefined, [issue(
      'mutation_commit_forbidden',
      '이 변경은 확인 카드의 host 확인 이후에만 실행할 수 있습니다.',
    )]);
  }
  const sessionId = options.workspaceSessionId?.trim();
  if (!sessionId) {
    return result(command.name, 'invalid', undefined, [issue('workspace_session_required', '확인한 변경을 실행하려면 현재 대화 세션이 필요합니다.')]);
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
      '확인한 변경의 workflow가 현재 대화의 workflow와 다릅니다. 해당 workflow에서 다시 요청해 주세요.',
    )]);
  }
  // One-shot: consume before executing so a retry or replay cannot run it twice.
  state.pendingMutations.delete(sessionId);
  const confirmedOptions: AxCommandExecuteOptions = { ...options, mutationConfirmationToken: undefined };
  confirmedExecutions.add(confirmedOptions);
  return execute(state, pending.command, confirmedOptions);
}
