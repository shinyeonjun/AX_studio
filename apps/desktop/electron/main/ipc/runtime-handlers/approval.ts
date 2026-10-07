import { ToolResultConfirmationSchema, ToolDraftUpdateSchema, ToolReviewRequestSchema, type ExecutionLogEntry, type ExecutionResult } from '@ax-studio/core';
import { connectorErrorMessage, executionErrorReason } from '@ax-studio/core';
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

const UNTRANSLATED = connectorErrorMessage('');

/** Why the step after an approval failed, when it can be said in Korean. */
function approvedRunFailureReason(entry: ExecutionLogEntry | undefined): string | undefined {
  if (!entry) return undefined;
  const byCode = executionErrorReason(entry.code);
  if (byCode) return byCode;
  if (/[가-힣]/u.test(entry.message)) return entry.message;
  const translated = connectorErrorMessage(entry.message);
  return translated !== UNTRANSLATED && translated !== entry.message ? translated : undefined;
}

export function registerRuntimeApprovalHandlers(): void {
  ipcHandle('ax:getToolResult', async (_e, lookup: unknown) => {
    const executionId = lookup && typeof lookup === 'object' && !Array.isArray(lookup) && Object.keys(lookup).length === 1
      && 'executionId' in lookup && typeof lookup.executionId === 'string' ? lookup.executionId : undefined;
    if (executionId !== undefined) {
      if (!executionId.trim() || executionId.length > 128) throw new Error('실행 기록을 찾을 수 없어요. 화면을 새로 고쳐 주세요.');
      const execution = getCore().store.getExecution(executionId);
      // Completed chats retain an execution ID. Read warning metadata only;
      // this path cannot restore an editable draft or initiate an action.
      return { executionId, source: undefined, outcome: undefined, requiresReview: false,
        ...executionWarnings(execution), cancelled: execution?.status === 'cancelled', processing: false };
    }
    if (typeof lookup !== 'string' || !lookup.trim() || lookup.length > 128) throw new Error('승인 요청을 찾을 수 없어요. 화면을 새로 고쳐 주세요.');
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
    if (typeof approvalId !== 'string' || !approvalId.trim()) throw new Error('승인 요청을 찾을 수 없어요. 화면을 새로 고쳐 주세요.');
    const result = await core.runtime.continueAfterApproval(approvalId);
    notifyStateChanged();
    if (result.status === 'failed') {
      // The approval went through; what failed is the step after it. Say why in plain Korean.
      const lastError = result.log?.filter((entry) => entry.level === 'error').at(-1);
      const reason = approvedRunFailureReason(lastError);
      // An unknown code goes through as is: the window translates the codes it knows.
      throw new Error(reason ? `승인했지만 실행 중 문제가 생겼어요. ${reason}` : lastError?.message ?? '승인했지만 실행 중 문제가 생겼어요. 활동 화면에서 이유를 확인해 주세요.');
    }
    return result;
  });
  ipcHandle('ax:reject', async (_e, approvalId: unknown) => {
    const core = getCore();
    if (typeof approvalId !== 'string' || !approvalId.trim()) throw new Error('승인 요청을 찾을 수 없어요. 화면을 새로 고쳐 주세요.');
    const approval = core.store.getApproval(approvalId);
    if (!approval) throw new Error('승인 요청을 찾을 수 없어요. 이미 삭제됐을 수 있어요.');
    if (!core.store.rejectPendingApproval(approvalId)) {
      throw new Error('이미 처리된 승인이에요. 화면을 새로 고쳐 주세요.');
    }
    core.runtime.discardToolDraft(approvalId);
    const execution = core.store.getExecution(approval.executionId);
    const preserveHistory = Boolean(execution?.historyDiagnostics?.some(diagnostic => diagnostic.source !== 'output'));
    const rejectionLog = executionLogWithRejection(preserveHistory ? undefined : execution?.logJson);
    core.store.finishExecution(
      approval.executionId,
      'cancelled',
      'approval_rejected',
      rejectionLog,
      { preserveHistory },
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
