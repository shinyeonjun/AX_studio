import type { Step } from '../../../workflow/schema.js';
import { validateWorkflowContracts } from '../../../workflow/contract-validator.js';
import {
  isExecutionCheckpoint,
  stepsById,
} from '../../control-flow.js';
import {
  createContractFailure,
  isContractFailure,
  validateOutputContract,
} from '../../output-contract.js';
import type { ExecutionResult } from '../../types.js';
import type { WorkflowExecutionHost, PendingError } from '../contracts.js';
import { createConnectorContext } from '../context.js';
import { runSequence } from '../sequence.js';
import { executeApprovedActions } from './approved-actions.js';
import { restoreApprovalSnapshot } from './snapshot.js';
import { prepareApprovalResume } from './guards.js';
import { approvalParamsHash } from '../../approval-snapshot.js';
import { resolveActionParamsForExecution } from '../../step-executor.js';
import type { ToolResultConfirmation, ToolSendOutcome } from '../../../contracts/tool-result.js';
import { requiresToolResultReview, type PreparedToolSend } from '../../tool-result-approval.js';

export async function continueWorkflowAfterApproval(
  host: WorkflowExecutionHost,
  approvalId: string,
  confirmation?: ToolResultConfirmation,
): Promise<ExecutionResult> {
  let prepared: PreparedToolSend | undefined;
  if (confirmation || requiresToolResultReview(host.config.store, approvalId)) {
    try {
      if (!confirmation) throw new Error('tool_result_confirmation_required');
      if (!host.toolResults) throw new Error('tool_result_confirmation_required');
      prepared = host.toolResults.prepare(approvalId, confirmation);
    } catch (error) {
      return { executionId: host.config.store.getApproval(approvalId)?.executionId ?? '', status: 'failed',
        pendingApprovalId: host.config.store.getApproval(approvalId)?.status === 'pending' ? approvalId : undefined,
        errorCode: error instanceof Error ? error.message : 'invalid_tool_result', log: [] };
    }
  }
  // Consume before attempting durable reservation: a failed write requires fresh review.
  if (prepared) host.toolResults?.consume(approvalId);
  const guard = prepareApprovalResume(host, approvalId, prepared ? {
    binding: prepared.review.binding, paramsHash: prepared.review.paramsHash,
  } : undefined);
  if (!guard.ok) return guard.result;
  const { approval, execution } = guard;
  let toolSendOutcome: ToolSendOutcome | undefined;

  const restored = restoreApprovalSnapshot(host, approvalId, approval.executionId, execution);
  if (!restored.ok) return restored.result;
  const { ir, log } = restored;

  const approvedActions = approval.actionIds.map((actionId) =>
    ir.steps.find(
      (step): step is Extract<Step, { type: 'action' }> => step.type === 'action' && step.id === actionId,
    ),
  );
  if (new Set(approval.actionIds).size !== approval.actionIds.length || approvedActions.some((step) => !step)) {
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
  const resolvedApprovedActions = approvedActions.filter(
    (step): step is Extract<Step, { type: 'action' }> => Boolean(step),
  );
  const payload = approval.payload as {
    checkpoint?: unknown;
    actionSnapshots?: Array<{ actionId?: unknown; actionRef?: unknown; paramsHash?: unknown }>;
  } | undefined;
  const checkpoint = isExecutionCheckpoint(payload?.checkpoint) ? payload.checkpoint : undefined;
  const connections = host.config.store.getConnections();
  const ctx = createConnectorContext(
    host,
    execution.id,
    execution.workflowId ?? undefined,
    { ...(checkpoint?.variables ?? {}) },
    connections,
    (entry) => {
      log.push(entry);
      host.config.store.updateExecutionLog(execution.id, log);
    },
    execution.workspaceSessionId,
  );
  ctx.outputs = { ...(checkpoint?.outputs ?? {}) };
  ctx.presentationVariableSources = { ...(checkpoint?.presentationVariableSources ?? {}) };
  const stepResults: Record<string, unknown> = { ...(checkpoint?.stepResults ?? {}) };
  const approvalSnapshots = new Map<string, { actionRef: string; paramsHash: string }>();
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

  try {
    const contractIssues = validateWorkflowContracts(ir, { runtimeConnectors: host.connectors });
    if (contractIssues.length > 0) {
      throw Object.assign(new Error(contractIssues[0]!.message), {
        code: 'contract_validation_failed',
        data: { issues: contractIssues },
      });
    }
    for (const action of resolvedApprovedActions) {
      const expected = approvalSnapshots.get(action.id);
      if (!expected) {
        throw Object.assign(new Error('승인 snapshot이 없습니다.'), { code: 'approval_snapshot_missing' });
      }
      const resolved = resolveActionParamsForExecution(action, ir, ctx, stepResults);
      if (resolved.actionDefinition.id !== expected.actionRef || approvalParamsHash(resolved.params) !== expected.paramsHash) {
        throw Object.assign(new Error('승인 당시의 실행 대상과 현재 실행 대상이 다릅니다.'), {
          code: 'approval_target_changed',
        });
      }
    }
    // Original bindings were checked above. A manually edited final send is literal data.
    // This path cannot affect branches, remaining steps, workflows or other approvals.
    const editedParams = prepared?.params;
    if (prepared && editedParams) {
      approvalSnapshots.set(prepared.source.actionId, {
        actionRef: approvalSnapshots.get(prepared.source.actionId)!.actionRef,
        paramsHash: approvalParamsHash(editedParams),
      });
      log.push({ at: new Date().toISOString(), level: 'info', code: 'tool_result_confirmed',
        message: '수정한 결과와 대상을 확인했습니다.',
        data: { actionId: prepared.source.actionId, paramsHash: approvalParamsHash(editedParams) } });
      ctx.literalMessage = true;
    }
    const remainingStepIds = new Set([
      ...(checkpoint?.remainingStepIds ?? []),
      ...(checkpoint?.pendingOuterStepIds ?? []),
    ]);
    // Nested branches own their actions: approval grants permission, not unconditional execution.
    const stepMap = new Map(ir.steps.map((step) => [step.id, step]));
    for (const id of remainingStepIds) {
      const step = stepMap.get(id);
      if (step?.type === 'if') {
        for (const child of [...step.thenStepIds, ...(step.elseStepIds ?? [])]) remainingStepIds.add(child);
      } else if (step?.type === 'human_approval') {
        for (const child of step.forActionIds) remainingStepIds.add(child);
      }
    }
    await executeApprovedActions({
      host,
      ir,
      approvedActions: resolvedApprovedActions,
      remainingStepIds,
      ctx,
      stepResults,
      approvalSnapshots,
      ...(editedParams ? { editedParams } : {}),
      ...(prepared ? { pinnedConnector: prepared.connector, onProviderSuccess: (data: unknown) => {
        const receipt = data && typeof data === 'object' ? data as Record<string, unknown> : {};
        const receiptId = prepared.review.binding.provider === 'gmail' ? receipt.id : receipt.ts;
        toolSendOutcome = { status: typeof receiptId === 'string' && receiptId.length > 0 ? 'sent' : 'unknown',
          binding: prepared.review.binding, paramsHash: prepared.review.paramsHash,
          ...(typeof receiptId === 'string' && receiptId.length > 0 ? { receiptId: receiptId.slice(0, 128) } : {}) };
        host.config.store.updateApprovalPayload(approvalId, { toolSendOutcome });
        if (toolSendOutcome.status === 'unknown') throw Object.assign(new Error('Missing provider receipt'), { code: 'tool_send_unknown' });
      } } : {}),
    });

    if (checkpoint) {
      await runSequence(
        host,
        stepsById(ir.steps, checkpoint.remainingStepIds),
        ir,
        ctx,
        stepResults,
        checkpoint.pendingOuterStepIds ?? [],
        new Set(approval.actionIds),
      );
    }

    if (ir.outputContract) {
      const output = validateOutputContract(ir.outputContract, ctx.variables, stepResults);
      if (!output.ok) throw createContractFailure('output_contract_failed', 'after_sequence', output);
    }

    host.config.store.resolveApproval(approvalId, true);
    host.config.store.finishExecution(execution.id, 'success', undefined, log);
    const successResult: ExecutionResult = { executionId: execution.id, status: 'success', log, ...(toolSendOutcome ? { toolSendOutcome } : {}) };
    if (host.notifyExecutionFinished(successResult) === false) successResult.refreshWarning = true;
    return successResult;
  } catch (err) {
    const error = err as PendingError;
    if (prepared) {
      toolSendOutcome ??= { status: 'unknown', binding: prepared.review.binding, paramsHash: prepared.review.paramsHash };
      const sent = toolSendOutcome.status === 'sent';
      let persistenceFailed = error.code === 'database_persistence_failed';
      const code = persistenceFailed ? 'database_persistence_failed' : sent ? 'tool_send_presentation_failed' : 'tool_send_unknown';
      log.push({ at: new Date().toISOString(), level: 'warn', code,
        message: sent ? 'Provider confirmed sending; result refresh failed.' : 'Send outcome is unknown. Check the provider before creating another request.' });
      persistenceFailed = false;
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
    if (error.pending && error.approvalId) {
      if (error.checkpoint) {
        host.config.store.updateApprovalPayload(error.approvalId, {
          checkpoint: error.checkpoint,
        });
      }
      host.config.store.resolveApproval(approvalId, true);
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
}
