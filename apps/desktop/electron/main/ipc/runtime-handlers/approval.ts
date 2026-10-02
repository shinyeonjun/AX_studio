import { ToolResultConfirmationSchema, ToolDraftUpdateSchema, ToolReviewRequestSchema, type ExecutionLogEntry, type ExecutionResult } from '@ax-studio/core';
import { getCore } from '../../core-instance.js';
import { notifyStateChanged } from '../../state-broadcast.js';
import { ipcHandle } from '../ipc-handle.js';

function executionLogWithRejection(
  logJson: string | null | undefined,
): ExecutionLogEntry[] {
  let log: ExecutionLogEntry[] = [];
  if (logJson) {
    try {
      const parsed = JSON.parse(logJson) as unknown;
      if (Array.isArray(parsed)) {
        log = parsed.filter((entry): entry is ExecutionLogEntry => {
          if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false;
          const candidate = entry as Record<string, unknown>;
          return typeof candidate.at === 'string' &&
            (candidate.level === 'info' || candidate.level === 'warn' || candidate.level === 'error') &&
            typeof candidate.message === 'string';
        });
      }
    } catch {
      // Keep the cancellation auditable even when an older execution has a
      // malformed log. The original malformed payload must not block the
      // state transition.
    }
  }
  return [
    ...log,
    {
      at: new Date().toISOString(),
      level: 'warn',
      code: 'approval_rejected',
      message: '승인이 거절되어 실행을 취소했습니다.',
    },
  ];
}

function executionWarnings(execution: { errorCode?: string | null; logJson?: string | null } | undefined) {
  let persistenceWarning = execution?.errorCode === 'database_persistence_failed';
  let refreshWarning = persistenceWarning;
  try {
    const entries: unknown = JSON.parse(execution?.logJson ?? '[]');
    persistenceWarning ||= Array.isArray(entries) && entries.some(entry => entry && typeof entry === 'object' && entry.code === 'database_persistence_failed');
    refreshWarning ||= Array.isArray(entries) && entries.some(entry => entry && typeof entry === 'object'
      && ['execution_refresh_failed', 'tool_send_presentation_failed', 'database_persistence_failed'].includes(entry.code));
  } catch { /* Legacy logs cannot change the provider outcome. */ }
  return { ...(refreshWarning ? { refreshWarning: true } : {}), ...(persistenceWarning ? { persistenceWarning: true } : {}) };
}

export function registerRuntimeApprovalHandlers(): void {
  ipcHandle('ax:getToolResult', async (_e, lookup: unknown) => {
    const executionId = lookup && typeof lookup === 'object' && !Array.isArray(lookup) && Object.keys(lookup).length === 1
      && 'executionId' in lookup && typeof lookup.executionId === 'string' ? lookup.executionId : undefined;
    if (executionId !== undefined) {
      if (!executionId.trim() || executionId.length > 128) throw new Error('Invalid execution ID');
      const execution = getCore().store.getExecution(executionId);
      // Completed chats retain an execution ID. Read warning metadata only;
      // this path cannot restore an editable draft or initiate an action.
      return { executionId, source: undefined, outcome: undefined, requiresReview: false,
        ...executionWarnings(execution), cancelled: execution?.status === 'cancelled', processing: false };
    }
    if (typeof lookup !== 'string' || !lookup.trim() || lookup.length > 128) throw new Error('Invalid approval ID');
    const approvalId = lookup;
    const core = getCore();
    const approval = core.store.getApproval(approvalId);
    const execution = approval && core.store.getExecution(approval.executionId);
    return { source: core.runtime.getToolResult(approvalId), outcome: core.runtime.getToolSendOutcome(approvalId),
      requiresReview: core.runtime.requiresToolResultReview(approvalId),
      ...executionWarnings(execution),
      cancelled: core.store.getApproval(approvalId)?.status === 'rejected',
      processing: core.store.getApproval(approvalId)?.status === 'processing' };
  });
  ipcHandle('ax:updateToolDraft', async (_e, input: unknown) => getCore().runtime.updateToolDraft(ToolDraftUpdateSchema.parse(input)));
  ipcHandle('ax:reviewToolResult', async (_e, input: unknown) => getCore().runtime.reviewToolResult(ToolReviewRequestSchema.parse(input)));
  ipcHandle('ax:confirmToolResult', async (_e, input: unknown) => {
    const core = getCore();
    const confirmation = ToolResultConfirmationSchema.parse(input);
    const result = await core.runtime.continueAfterApproval(confirmation.approvalId, confirmation);
    try { notifyStateChanged(); } catch { result.refreshWarning = true; }
    return result;
  });
  ipcHandle('ax:approve', async (_e, approvalId: unknown) => {
    const core = getCore();
    if (typeof approvalId !== 'string' || !approvalId.trim()) throw new Error('approvalId가 필요합니다.');
    const result = await core.runtime.continueAfterApproval(approvalId);
    notifyStateChanged();
    if (result.status === 'failed') {
      const lastError = result.log?.filter((entry) => entry.level === 'error').at(-1);
      throw new Error(lastError?.message ?? '승인 후 실행에 실패했습니다.');
    }
    return result;
  });
  ipcHandle('ax:reject', async (_e, approvalId: unknown) => {
    const core = getCore();
    if (typeof approvalId !== 'string' || !approvalId.trim()) throw new Error('approvalId가 필요합니다.');
    const approval = core.store.getApproval(approvalId);
    if (!approval) throw new Error('Approval not found');
    if (!core.store.rejectPendingApproval(approvalId)) {
      throw new Error('Approval is already being processed or resolved');
    }
    core.runtime.discardToolDraft(approvalId);
    const execution = core.store.getExecution(approval.executionId);
    const rejectionLog = executionLogWithRejection(execution?.logJson);
    core.store.finishExecution(
      approval.executionId,
      'cancelled',
      'approval_rejected',
      rejectionLog,
    );
    const rejectionResult: ExecutionResult = {
      executionId: approval.executionId,
      status: 'cancelled',
      errorCode: 'approval_rejected',
      log: rejectionLog,
    };
    try { core.runtime.notifyExecutionFinished(rejectionResult); } catch { /* Cancellation already committed. */ }
    try { notifyStateChanged(); } catch { /* Cancellation already committed. */ }
    return { ok: true };
  });
}
