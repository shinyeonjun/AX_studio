import { useState } from 'react';
import type { ExecutionResultStatus, WorkspaceChatApproval } from '@ax-studio/core';

interface WorkspaceRunResultCardProps {
  content: string;
  status?: ExecutionResultStatus;
  approval?: WorkspaceChatApproval;
  busy?: boolean;
  onApprove?: (approvalId: string) => Promise<void>;
  onReject?: (approvalId: string) => Promise<void>;
}

const LEGACY_EXECUTION_STATUS_PATTERNS: Array<[ExecutionResultStatus, RegExp]> = [
  ['success', /^(?:「[^」\r\n]{1,240}」|업무)\s+실행이\s+완료되었습니다[.!]?$/],
  ['pending_approval', /^(?:「[^」\r\n]{1,240}」|업무)\s+실행이\s+승인 대기 중입니다[.!]?$/],
  ['cancelled', /^(?:「[^」\r\n]{1,240}」|업무)\s+실행이\s+취소되었습니다[.!]?$/],
  ['failed', /^(?:「[^」\r\n]{1,240}」|업무)\s+실행에\s+실패했습니다[.!]?$/],
];

/**
 * Old host-generated result messages predate executionStatus. Only the exact
 * status sentence emitted by formatExecutionResultMessage is eligible for
 * compatibility inference; ordinary assistant prose remains unclassified.
 */
export function resolveWorkspaceExecutionStatus(
  status: ExecutionResultStatus | undefined,
  content: string,
): ExecutionResultStatus | undefined {
  if (status) return status;
  const firstLine = content.split(/\r?\n/, 1)[0]?.trim();
  if (!firstLine) return undefined;
  return LEGACY_EXECUTION_STATUS_PATTERNS.find(([, pattern]) => pattern.test(firstLine))?.[0];
}

function statusPresentation(status: ExecutionResultStatus | undefined): {
  label: string;
  className: string;
} {
  switch (status) {
    case 'pending_approval':
      return { label: '승인 대기', className: 'ax-workspace-run-card--approval' };
    case 'success':
      return { label: '실행 완료', className: '' };
    case 'cancelled':
      return { label: '실행 취소', className: 'ax-workspace-run-card--cancelled' };
    case 'failed':
      return { label: '실행 실패', className: '' };
    default:
      return { label: '실행 결과', className: '' };
  }
}

export function WorkspaceRunResultCard({
  content,
  status,
  approval,
  busy = false,
  onApprove,
  onReject,
}: WorkspaceRunResultCardProps) {
  const resolvedStatus = resolveWorkspaceExecutionStatus(status, content);
  const presentation = statusPresentation(resolvedStatus);
  const [busyAction, setBusyAction] = useState<'approve' | 'reject' | null>(null);
  const [actionError, setActionError] = useState('');

  const runApprovalAction = async (action: 'approve' | 'reject') => {
    if (!approval || !onApprove || !onReject || busy || busyAction) return;
    setBusyAction(action);
    setActionError('');
    try {
      if (action === 'approve') await onApprove(approval.id);
      else await onReject(approval.id);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : '승인 처리에 실패했습니다.');
    } finally {
      setBusyAction(null);
    }
  };

  return (
    <div
      className={`ax-workspace-run-card ${presentation.className}`.trim()}
      role="status"
      aria-busy={busyAction !== null || busy}
    >
      <p className="ax-workspace-run-card-label">
        {presentation.label}
      </p>
      <p>{content}</p>
      {approval && (
        <section className="ax-workspace-inline-approval" aria-label="외부 작업 승인">
          <div className="ax-workspace-inline-approval-copy">
            <span className="ax-workspace-inline-approval-eyebrow">외부 작업 전 확인</span>
            <h3>{approval.title}</h3>
            <p>{approval.reason}</p>
          </div>
          <div className="ax-workspace-inline-approval-actions">
            <button
              type="button"
              className="ax-workspace-inline-approval-btn ax-workspace-inline-approval-btn--primary"
              disabled={busy || busyAction !== null || !onApprove}
              onClick={() => void runApprovalAction('approve')}
            >
              {busyAction === 'approve' ? '처리 중…' : '승인하고 실행'}
            </button>
            <button
              type="button"
              className="ax-workspace-inline-approval-btn ax-workspace-inline-approval-btn--secondary"
              disabled={busy || busyAction !== null || !onReject}
              onClick={() => void runApprovalAction('reject')}
            >
              {busyAction === 'reject' ? '처리 중…' : '취소'}
            </button>
          </div>
          {actionError && <p className="ax-workspace-inline-approval-error" role="alert">{actionError}</p>}
        </section>
      )}
    </div>
  );
}

function isRunResultMessage(message: { kind?: 'execution_result' }): boolean {
  return message.kind === 'execution_result';
}

export { isRunResultMessage };
