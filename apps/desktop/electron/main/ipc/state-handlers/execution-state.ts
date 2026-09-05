import {
  formatApprovalTitle,
  parseWorkflowIR,
} from '@ax-studio/core';
import type { AxCore } from '../../core-instance.js';
import { executionLogSummary } from '../execution-log-summary.js';

export function executionQualityState(execution: {
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
    let hasOutputContract = false;
    if (execution.irJson) {
      try {
        hasOutputContract = Boolean(parseWorkflowIR(JSON.parse(execution.irJson)).outputContract);
      } catch {
        hasOutputContract = false;
      }
    }
    return { technicalStatus: 'completed', resultStatus: hasOutputContract ? 'passed' : 'not_evaluated' };
  }
  if (execution.status === 'pending_approval') {
    return { technicalStatus: 'waiting_approval', resultStatus: 'not_evaluated' };
  }
  return { technicalStatus: execution.status, resultStatus: 'not_evaluated' };
}

export function buildPendingApprovals(core: AxCore) {
  return core.store.getPendingApprovals().map((approval) => {
    const execution = core.store.getExecution(approval.executionId);
    let ir = null;
    let snapshotError: string | undefined;
    if (!execution?.irJson) {
      snapshotError = '승인 재개에 필요한 실행 스냅샷이 없습니다.';
    } else {
      try {
        ir = parseWorkflowIR(JSON.parse(execution.irJson));
      } catch (error) {
        snapshotError = error instanceof Error ? error.message : String(error);
      }
    }
    return {
      ...approval,
      ...(snapshotError ? { errorCode: 'invalid_execution_snapshot', errorMessage: snapshotError } : {}),
      title: formatApprovalTitle({
        workName: ir?.name,
        reason: approval.reason,
        actionIds: approval.actionIds,
        ir,
      }),
    };
  });
}

export function buildExecutions(core: AxCore) {
  return core.store.listExecutions(50).map((execution) => {
    const logSummary = executionLogSummary(execution.logJson);
    const quality = executionQualityState(execution);
    const errorMessage =
      logSummary.errorMessage ??
      (execution.status === 'failed' && execution.logJson ? '실행 로그를 읽지 못했습니다.' : undefined);
    return {
      id: execution.id,
      workflowId: execution.workflowId,
      ephemeral: execution.ephemeral,
      workspaceSessionId: execution.workspaceSessionId,
      status: execution.status,
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
    };
  });
}
