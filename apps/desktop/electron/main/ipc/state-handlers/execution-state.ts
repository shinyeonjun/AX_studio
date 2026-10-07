import {
  formatApprovalTitle,
  parseWorkflowIR,
} from '@ax-studio/core';
import type { AxCore } from '../../core-instance.js';
import { executionLogSummary } from '../execution-log-summary.js';

/**
 * Every state refresh rebuilds the latest executions. An execution's IR snapshot never changes and
 * its log only grows, so the parsed answers are reused until the stored text changes. Bounded: the
 * refresh lists 50 executions, older ids simply fall out.
 */
const MAX_CACHED_EXECUTIONS = 200;
type IrFacts = { hasOutputContract: boolean; name?: string };
const irFactsByExecution = new Map<string, { irJson: string; facts: IrFacts }>();
const logSummaryByExecution = new Map<string, { logJson: string | null; status: string; summary: ReturnType<typeof executionLogSummary> }>();

function remember<V>(cache: Map<string, V>, key: string, value: V): V {
  cache.delete(key);
  cache.set(key, value);
  if (cache.size > MAX_CACHED_EXECUTIONS) cache.delete(cache.keys().next().value!);
  return value;
}

/** What a run's IR snapshot says about it: whether it checks its output, and what it was called. */
function irFacts(id: string | undefined, irJson: string): IrFacts {
  const cached = id ? irFactsByExecution.get(id) : undefined;
  if (cached && cached.irJson === irJson) return cached.facts;
  let facts: IrFacts = { hasOutputContract: false };
  try {
    const ir = parseWorkflowIR(JSON.parse(irJson));
    facts = { hasOutputContract: Boolean(ir.outputContract), ...(ir.name?.trim() ? { name: ir.name.trim() } : {}) };
  } catch {
    // An unreadable snapshot has no name and no contract; the run is still listed.
  }
  return id ? remember(irFactsByExecution, id, { irJson, facts }).facts : facts;
}

function cachedLogSummary(id: string, logJson: string | null, status: string): ReturnType<typeof executionLogSummary> {
  const cached = logSummaryByExecution.get(id);
  if (cached && cached.logJson === logJson && cached.status === status) return cached.summary;
  return remember(logSummaryByExecution, id, { logJson, status, summary: executionLogSummary(logJson, status) }).summary;
}

export function executionQualityState(execution: {
  id?: string;
  status: string;
  errorCode: string | null;
  irJson?: string;
}): { technicalStatus: string; resultStatus: 'passed' | 'failed' | 'not_evaluated' } {
  if (execution.errorCode === 'input_schema_drift') {
    return { technicalStatus: 'blocked', resultStatus: 'not_evaluated' };
  }
  if (execution.errorCode === 'output_contract_failed') {
    return { technicalStatus: 'completed', resultStatus: 'failed' };
  }
  if (execution.status === 'success') {
    const passed = execution.irJson ? irFacts(execution.id, execution.irJson).hasOutputContract : false;
    return { technicalStatus: 'completed', resultStatus: passed ? 'passed' : 'not_evaluated' };
  }
  if (execution.status === 'pending_approval') {
    return { technicalStatus: 'waiting_approval', resultStatus: 'not_evaluated' };
  }
  return { technicalStatus: execution.status, resultStatus: 'not_evaluated' };
}

export function buildPendingApprovals(core: AxCore) {
  return core.store.getPendingApprovalsWithExecutionSnapshots().map(({ approval, executionIrJson }) => {
    let ir = null;
    let snapshotError: string | undefined;
    if (!executionIrJson) {
      snapshotError = '승인 재개에 필요한 실행 스냅샷이 없습니다.';
    } else {
      try {
        ir = parseWorkflowIR(JSON.parse(executionIrJson));
      } catch (error) {
        snapshotError = error instanceof Error ? error.message : String(error);
      }
    }
    const payload = approval.payload && typeof approval.payload === 'object'
      ? approval.payload as { actionSnapshots?: Array<{ actionId?: unknown; params?: unknown }> }
      : undefined;
    const resolvedParamsByAction = Object.fromEntries(
      (payload?.actionSnapshots ?? [])
        .filter((snapshot): snapshot is { actionId: string; params: Record<string, unknown> } =>
          typeof snapshot.actionId === 'string' && !!snapshot.params && typeof snapshot.params === 'object' && !Array.isArray(snapshot.params))
        .map((snapshot) => [snapshot.actionId, snapshot.params]),
    );
    return {
      ...approval,
      ...(snapshotError ? { errorCode: 'invalid_execution_snapshot', errorMessage: snapshotError } : {}),
      title: formatApprovalTitle({
        workName: ir?.name,
        reason: approval.reason,
        actionIds: approval.actionIds,
        ir,
        resolvedParamsByAction,
      }),
    };
  });
}

export function buildExecutions(core: AxCore) {
  return core.store.listExecutions(50, false).map((execution) => {
    const logSummary = execution.historyDiagnostics?.some(diagnostic => diagnostic.source !== 'output')
      ? {} : cachedLogSummary(execution.id, execution.logJson, execution.status);
    const quality = executionQualityState(execution);
    const name = execution.irJson ? irFacts(execution.id, execution.irJson).name : undefined;
    const resumeFailure = execution.status !== 'failed' ? undefined
      : execution.errorCode === 'invalid_execution_snapshot' ? '실행 스냅샷 검증에 실패하여 실행을 재개하지 못했습니다.'
        : execution.errorCode === 'invalid_execution_log' ? '실행 로그 검증에 실패하여 실행을 재개하지 못했습니다.'
          : undefined;
    const errorMessage =
      resumeFailure ??
      logSummary.errorMessage ??
      (execution.status === 'failed' && execution.logJson ? '실행 로그를 읽지 못했습니다.' : undefined);
    return {
      id: execution.id,
      workflowId: execution.workflowId,
      ephemeral: execution.ephemeral,
      ...(name ? { name } : {}),
      workspaceSessionId: execution.workspaceSessionId,
      status: execution.status,
      hasOutput: execution.hasOutput,
      historyDiagnostics: execution.historyDiagnostics,
      startedAt: execution.startedAt,
      finishedAt: execution.finishedAt,
      errorCode: execution.errorCode,
      errorMessage,
      technicalStatus: quality.technicalStatus,
      resultStatus: quality.resultStatus,
      triggerType: execution.triggerType,
      currentStepId: logSummary.currentStepId,
      currentStepStatus: logSummary.currentStepStatus,
      currentStepMessage: logSummary.currentStepMessage,
      lastLogMessage: logSummary.lastLogMessage,
      aiOutput: logSummary.aiOutput,
      generatedPdf: logSummary.generatedPdf,
      sourceFile: logSummary.sourceFile,
      computedResults: logSummary.computedResults,
    };
  });
}
