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

export async function continueWorkflowAfterApproval(
  host: WorkflowExecutionHost,
  approvalId: string,
): Promise<ExecutionResult> {
  const guard = prepareApprovalResume(host, approvalId);
  if (!guard.ok) return guard.result;
  const { approval, execution } = guard;

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
    const successResult: ExecutionResult = { executionId: execution.id, status: 'success', log };
    host.notifyExecutionFinished(successResult);
    return successResult;
  } catch (err) {
    const error = err as PendingError;
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
