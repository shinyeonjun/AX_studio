import type { ConnectorContext, ExecutionLogEntry } from '../../../connectors/types.js';
import type { Step, WorkflowIR } from '../../../workflow/schema.js';
import { validateWorkflowContracts } from '../../../workflow/contract-validator.js';
import {
  isExecutionCheckpoint,
  stepsById,
  type ExecutionCheckpoint,
} from '../../control-flow.js';
import {
  createContractFailure,
  isContractFailure,
  validateOutputContract,
} from '../../output-contract.js';
import type { ExecutionResult } from '../../types.js';
import type { WorkflowExecutionHost, PendingError } from '../contracts.js';
import { createConnectorContext } from '../context.js';
import { createExecutionLogWriter } from '../log-writer.js';
import { runSequence } from '../sequence.js';
import { executeApprovedActions } from './approved-actions.js';
import { restoreApprovalSnapshot } from './snapshot.js';
import { prepareApprovalResume, type ApprovalResumeGuard } from './guards.js';
import { approvalParamsHash } from '../../approval-snapshot.js';
import { resolveActionParamsForExecution } from '../../step-executor.js';
import type { ToolResultConfirmation, ToolSendOutcome } from '../../../contracts/tool-result.js';
import { requiresToolResultReview, type PreparedToolSend } from '../../tool-result-approval.js';

type ActionStep = Extract<Step, { type: 'action' }>;
type Approval = Extract<ApprovalResumeGuard, { ok: true }>['approval'];
type Execution = Extract<ApprovalResumeGuard, { ok: true }>['execution'];
type ApprovalSnapshots = Map<string, { actionRef: string; paramsHash: string }>;

interface ResumeState {
  host: WorkflowExecutionHost;
  approvalId: string;
  approval: Approval;
  execution: Execution;
  ir: WorkflowIR;
  log: ExecutionLogEntry[];
  ctx: ConnectorContext;
  stepResults: Record<string, unknown>;
  checkpoint?: ExecutionCheckpoint;
  approvalSnapshots: ApprovalSnapshots;
  prepared?: PreparedToolSend;
  toolSendOutcome?: ToolSendOutcome;
}

export async function continueWorkflowAfterApproval(
  host: WorkflowExecutionHost,
  approvalId: string,
  confirmation?: ToolResultConfirmation,
  abortSignal?: AbortSignal,
): Promise<ExecutionResult> {
  const confirmed = prepareConfirmedToolSend(host, approvalId, confirmation);
  if (!confirmed.ok) return confirmed.result;
  const { prepared } = confirmed;
  // Consume before attempting durable reservation: a failed write requires fresh review.
  if (prepared) host.toolResults?.consume(approvalId);
  const guard = prepareApprovalResume(host, approvalId, prepared ? {
    binding: prepared.review.binding, paramsHash: prepared.review.paramsHash,
  } : undefined);
  if (!guard.ok) return guard.result;
  const { approval, execution } = guard;

  const restored = restoreApprovalSnapshot(host, approvalId, approval.executionId, execution);
  if (!restored.ok) return restored.result;
  const { ir, log } = restored;

  const approvedActions = resolveApprovedActions(host, approvalId, approval, execution, ir);
  if (!Array.isArray(approvedActions)) return approvedActions;

  const state = createResumeState(host, approvalId, approval, execution, ir, log, abortSignal, prepared);
  try {
    verifyApprovalTargets(state, approvedActions);
    const editedParams = applyConfirmedEdit(state);
    await executeApprovedActions({
      host,
      ir,
      approvedActions,
      remainingStepIds: expandRemainingStepIds(ir, state.checkpoint),
      ctx: state.ctx,
      stepResults: state.stepResults,
      approvalSnapshots: state.approvalSnapshots,
      ...(editedParams ? { editedParams } : {}),
      ...(prepared ? { pinnedConnector: prepared.connector, onProviderSuccess: (data: unknown) => recordProviderReceipt(state, data) } : {}),
    });

    if (state.checkpoint) {
      await runSequence(
        host,
        stepsById(ir.steps, state.checkpoint.remainingStepIds),
        ir,
        state.ctx,
        state.stepResults,
        state.checkpoint.pendingOuterStepIds ?? [],
        new Set(approval.actionIds),
      );
    }
    // A connector may finish after an abort; never report that as success.
    abortSignal?.throwIfAborted();

    if (ir.outputContract) {
      const output = validateOutputContract(ir.outputContract, state.ctx.variables, state.stepResults);
      if (!output.ok) throw createContractFailure('output_contract_failed', 'after_sequence', output);
    }
    return finishResumeSuccess(state);
  } catch (err) {
    const error = err as PendingError;
    if (state.prepared) return finishToolSendFailure(state, state.prepared, error);
    if (error.pending && error.approvalId) return finishResumePending(state, error);
    if (abortSignal?.aborted) return finishResumeCancelled(state);
    return finishResumeFailure(state, error);
  }
}

function prepareConfirmedToolSend(
  host: WorkflowExecutionHost,
  approvalId: string,
  confirmation?: ToolResultConfirmation,
): { ok: true; prepared?: PreparedToolSend } | { ok: false; result: ExecutionResult } {
  if (!confirmation && !requiresToolResultReview(host.config.store, approvalId)) return { ok: true };
  try {
    if (!confirmation) throw new Error('tool_result_confirmation_required');
    if (!host.toolResults) throw new Error('tool_result_confirmation_required');
    return { ok: true, prepared: host.toolResults.prepare(approvalId, confirmation) };
  } catch (error) {
    const approval = host.config.store.getApproval(approvalId);
    return { ok: false, result: { executionId: approval?.executionId ?? '', status: 'failed',
      pendingApprovalId: approval?.status === 'pending' ? approvalId : undefined,
      errorCode: error instanceof Error ? error.message : 'invalid_tool_result', log: [] } };
  }
}

function resolveApprovedActions(
  host: WorkflowExecutionHost,
  approvalId: string,
  approval: Approval,
  execution: Execution,
  ir: WorkflowIR,
): ActionStep[] | ExecutionResult {
  const approvedActions = approval.actionIds.map((actionId) =>
    ir.steps.find((step): step is ActionStep => step.type === 'action' && step.id === actionId),
  );
  if (new Set(approval.actionIds).size === approval.actionIds.length && approvedActions.every((step) => step)) {
    return approvedActions.filter((step): step is ActionStep => Boolean(step));
  }
  host.config.store.failApproval(approvalId);
  const failureLog = [{
    at: new Date().toISOString(),
    level: 'error' as const,
    code: 'invalid_approval_actions',
    message: '승인 대상 작업이 실행 스냅샷과 일치하지 않습니다.',
  }];
  host.config.store.finishExecution(execution.id, 'failed', 'invalid_approval_actions', failureLog);
  const result: ExecutionResult = {
    executionId: approval.executionId,
    status: 'failed',
    errorCode: 'invalid_approval_actions',
    log: failureLog,
  };
  host.notifyExecutionFinished(result);
  return result;
}

function createResumeState(
  host: WorkflowExecutionHost,
  approvalId: string,
  approval: Approval,
  execution: Execution,
  ir: WorkflowIR,
  log: ExecutionLogEntry[],
  abortSignal: AbortSignal | undefined,
  prepared: PreparedToolSend | undefined,
): ResumeState {
  const payload = approval.payload as {
    checkpoint?: unknown;
    actionSnapshots?: Array<{ actionId?: unknown; actionRef?: unknown; paramsHash?: unknown }>;
  } | undefined;
  const checkpoint = isExecutionCheckpoint(payload?.checkpoint) ? payload.checkpoint : undefined;
  const ctx = createConnectorContext(
    host,
    execution.id,
    execution.workflowId ?? undefined,
    { ...(checkpoint?.variables ?? {}) },
    host.config.store.getConnections(),
    createExecutionLogWriter(host.config.store, execution.id, log),
    execution.workspaceSessionId,
    abortSignal,
  );
  ctx.outputs = { ...(checkpoint?.outputs ?? {}) };
  ctx.presentationVariableSources = { ...(checkpoint?.presentationVariableSources ?? {}) };
  const approvalSnapshots: ApprovalSnapshots = new Map();
  for (const snapshot of payload?.actionSnapshots ?? []) {
    if (typeof snapshot.actionId === 'string'
      && typeof snapshot.actionRef === 'string'
      && typeof snapshot.paramsHash === 'string') {
      approvalSnapshots.set(snapshot.actionId, {
        actionRef: snapshot.actionRef,
        paramsHash: snapshot.paramsHash,
      });
    }
  }
  return {
    host, approvalId, approval, execution, ir, log, ctx, checkpoint, approvalSnapshots, prepared,
    stepResults: { ...(checkpoint?.stepResults ?? {}) },
  };
}

/** Re-resolves every approved action and requires it to match the approved snapshot exactly. */
function verifyApprovalTargets(state: ResumeState, approvedActions: ActionStep[]): void {
  const contractIssues = validateWorkflowContracts(state.ir, { runtimeConnectors: state.host.connectors });
  if (contractIssues.length > 0) {
    throw Object.assign(new Error(contractIssues[0]!.message), {
      code: 'contract_validation_failed',
      data: { issues: contractIssues },
    });
  }
  for (const action of approvedActions) {
    const expected = state.approvalSnapshots.get(action.id);
    if (!expected) {
      throw Object.assign(new Error('승인 snapshot이 없습니다.'), { code: 'approval_snapshot_missing' });
    }
    const resolved = resolveActionParamsForExecution(action, state.ir, state.ctx, state.stepResults);
    if (resolved.actionDefinition.id !== expected.actionRef || approvalParamsHash(resolved.params) !== expected.paramsHash) {
      throw Object.assign(new Error('승인 당시의 실행 대상과 현재 실행 대상이 다릅니다.'), {
        code: 'approval_target_changed',
      });
    }
  }
}

/**
 * Original bindings were checked by verifyApprovalTargets. A manually edited
 * final send is literal data and cannot affect branches, remaining steps,
 * workflows or other approvals.
 */
function applyConfirmedEdit(state: ResumeState): Record<string, unknown> | undefined {
  const editedParams = state.prepared?.params;
  if (!state.prepared || !editedParams) return undefined;
  const actionId = state.prepared.source.actionId;
  state.approvalSnapshots.set(actionId, {
    actionRef: state.approvalSnapshots.get(actionId)!.actionRef,
    paramsHash: approvalParamsHash(editedParams),
  });
  state.log.push({ at: new Date().toISOString(), level: 'info', code: 'tool_result_confirmed',
    message: '수정한 결과와 대상을 확인했습니다.',
    data: { actionId, paramsHash: approvalParamsHash(editedParams) } });
  state.ctx.literalMessage = true;
  return editedParams;
}

/** Nested branches own their actions: approval grants permission, not unconditional execution. */
function expandRemainingStepIds(ir: WorkflowIR, checkpoint: ExecutionCheckpoint | undefined): Set<string> {
  const remainingStepIds = new Set([
    ...(checkpoint?.remainingStepIds ?? []),
    ...(checkpoint?.pendingOuterStepIds ?? []),
  ]);
  const stepMap = new Map(ir.steps.map((step) => [step.id, step]));
  for (const id of remainingStepIds) {
    const step = stepMap.get(id);
    if (step?.type === 'if') {
      for (const child of [...step.thenStepIds, ...(step.elseStepIds ?? [])]) remainingStepIds.add(child);
    } else if (step?.type === 'human_approval') {
      for (const child of step.forActionIds) remainingStepIds.add(child);
    }
  }
  return remainingStepIds;
}

function recordProviderReceipt(state: ResumeState, data: unknown): void {
  const prepared = state.prepared!;
  const receipt = data && typeof data === 'object' ? data as Record<string, unknown> : {};
  const receiptId = prepared.review.binding.provider === 'gmail' ? receipt.id : receipt.ts;
  const hasReceipt = typeof receiptId === 'string' && receiptId.length > 0;
  state.toolSendOutcome = { status: hasReceipt ? 'sent' : 'unknown',
    binding: prepared.review.binding, paramsHash: prepared.review.paramsHash,
    ...(hasReceipt ? { receiptId: receiptId.slice(0, 128) } : {}) };
  state.host.config.store.updateApprovalPayload(state.approvalId, { toolSendOutcome: state.toolSendOutcome });
  if (state.toolSendOutcome.status === 'unknown') throw Object.assign(new Error('Missing provider receipt'), { code: 'tool_send_unknown' });
}

function finishResumeSuccess(state: ResumeState): ExecutionResult {
  const { host, execution, log, toolSendOutcome } = state;
  host.config.store.resolveApproval(state.approvalId, true);
  host.config.store.finishExecution(execution.id, 'success', undefined, log);
  const successResult: ExecutionResult = { executionId: execution.id, status: 'success', log, ...(toolSendOutcome ? { toolSendOutcome } : {}) };
  if (host.notifyExecutionFinished(successResult) === false) successResult.refreshWarning = true;
  return successResult;
}

function finishToolSendFailure(state: ResumeState, prepared: PreparedToolSend, error: PendingError): ExecutionResult {
  const { host, approvalId, execution, log } = state;
  const toolSendOutcome: ToolSendOutcome = state.toolSendOutcome
    ?? { status: 'unknown', binding: prepared.review.binding, paramsHash: prepared.review.paramsHash };
  const sent = toolSendOutcome.status === 'sent';
  const code = error.code === 'database_persistence_failed'
    ? 'database_persistence_failed'
    : sent ? 'tool_send_presentation_failed' : 'tool_send_unknown';
  log.push({ at: new Date().toISOString(), level: 'warn', code,
    message: sent ? 'Provider confirmed sending; result refresh failed.' : 'Send outcome is unknown. Check the provider before creating another request.' });
  let persistenceFailed = false;
  const record = (write: () => void) => { try { write(); } catch { persistenceFailed = true; } };
  record(() => host.config.store.updateApprovalPayload(approvalId, { toolSendOutcome }));
  record(() => { if (sent) host.config.store.resolveApproval(approvalId, true); else host.config.store.failApproval(approvalId); });
  if (persistenceFailed && code !== 'database_persistence_failed') log.push({ at: new Date().toISOString(), level: 'warn',
    code: 'database_persistence_failed', message: 'Local outcome persistence failed. The durable claim remains consumed.' });
  record(() => host.config.store.finishExecution(execution.id, sent && !persistenceFailed ? 'success' : 'failed',
    persistenceFailed ? 'database_persistence_failed' : sent ? undefined : code, log));
  const result: ExecutionResult = { executionId: execution.id, status: sent && !persistenceFailed ? 'success' : 'failed',
    ...(sent ? { refreshWarning: true } : {}),
    ...(!sent || persistenceFailed ? { errorCode: persistenceFailed ? 'database_persistence_failed' : code } : {}),
    toolSendOutcome, log };
  try { if (host.notifyExecutionFinished(result) === false) result.refreshWarning = true; }
  catch { result.refreshWarning = true; }
  return result;
}

function finishResumePending(state: ResumeState, error: PendingError): ExecutionResult {
  const { host, execution, log } = state;
  if (error.checkpoint) {
    host.config.store.updateApprovalPayload(error.approvalId!, {
      checkpoint: error.checkpoint,
    });
  }
  host.config.store.resolveApproval(state.approvalId, true);
  host.config.store.markExecutionPending(execution.id, 'pending_approval', log);
  const pendingResult: ExecutionResult = {
    executionId: execution.id,
    status: 'pending_approval',
    pendingApprovalId: error.approvalId,
    log,
  };
  host.notifyExecutionFinished(pendingResult);
  return pendingResult;
}

function finishResumeCancelled(state: ResumeState): ExecutionResult {
  const { host, execution, log } = state;
  log.push({
    at: new Date().toISOString(),
    level: 'warn',
    code: 'cancelled',
    message: '승인 후 실행이 취소되었습니다. 외부 작업 결과를 확인하세요. 자동으로 다시 실행하지 않습니다.',
  });
  // The approval was consumed by this attempt; it is never re-armed.
  host.config.store.resolveApproval(state.approvalId, true);
  host.config.store.finishExecution(execution.id, 'cancelled', 'cancelled', log);
  const result: ExecutionResult = { executionId: execution.id, status: 'cancelled', errorCode: 'cancelled', log };
  host.notifyExecutionFinished(result);
  return result;
}

function finishResumeFailure(state: ResumeState, error: PendingError): ExecutionResult {
  const { host, approvalId, execution, log } = state;
  const code = error.code ?? 'execution_failed';
  log.push({
    at: new Date().toISOString(),
    level: 'error',
    code,
    message: error.message,
    ...(isContractFailure(error) ? { data: error.data } : {}),
  });
  if (code === 'approval_snapshot_missing' || code === 'approval_target_changed') {
    host.config.store.failApproval(approvalId);
  } else {
    host.config.store.resolveApproval(approvalId, true);
  }
  host.config.store.finishExecution(execution.id, 'failed', code, log);
  const failedResult: ExecutionResult = { executionId: execution.id, status: 'failed', errorCode: code, log };
  host.notifyExecutionFinished(failedResult);
  return failedResult;
}
