import { useState } from 'react';
import type { AppState } from '../../types/app-state';
import { ipcErrorMessage } from '../../lib/ipc-error';
import { PageHeader } from '../layout/PageHeader';

interface ApprovalsPageProps {
  state: AppState | null;
  onRefresh: () => Promise<void>;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}

export function ApprovalsPage({ state, onRefresh, onApprove, onReject }: ApprovalsPageProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');

  const approvals = state?.approvals ?? [];

  const runAction = async (id: string, action: 'approve' | 'reject') => {
    setBusyId(id);
    setActionError('');
    try {
      if (action === 'approve') await onApprove(id);
      else await onReject(id);
      await onRefresh();
    } catch (error) {
      setActionError(ipcErrorMessage(error, '승인 처리에 실패했습니다.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader
        title="승인"
        subtitle="외부 전송·고위험 작업은 실행 전에 승인이 필요합니다"
      />
      <div className="page-content">
        {actionError && (
          <div className="approval-error" role="alert">
            {actionError}
          </div>
        )}

        {approvals.length === 0 ? (
          <div className="empty-state">
            <p>대기 중인 승인이 없습니다</p>
            <p className="muted">
              업무 실행 중 외부 전송이나 고위험 작업이 필요하면 여기에 표시됩니다.
            </p>
          </div>
        ) : (
          approvals.map((approval) => {
            const busy = busyId === approval.id;
            return (
              <article key={approval.id} className="approval-card">
                <h3>{approval.title ?? approval.reason}</h3>
                <p className="muted">{approval.reason}</p>
                <div className="approval-actions">
                  <button
                    type="button"
                    className="btn btn-approve"
                    disabled={busy}
                    onClick={() => void runAction(approval.id, 'approve')}
                  >
                    {busy ? '처리 중…' : '승인'}
                  </button>
                  <button
                    type="button"
                    className="btn btn-reject"
                    disabled={busy}
                    onClick={() => void runAction(approval.id, 'reject')}
                  >
                    거절
                  </button>
                </div>
              </article>
            );
          })
        )}
      </div>
    </>
  );
}
