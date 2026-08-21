import { useState } from 'react';
import type { AppState } from '../../types/app-state';
import { formatRelativeTime } from '../../lib/work-display';
import { ipcErrorMessage } from '../../lib/ipc-error';
import { PageHeader } from '../layout/PageHeader';

interface ApprovalPageProps {
  approvals: AppState['approvals'];
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}

export function ApprovalPage({ approvals, onApprove, onReject }: ApprovalPageProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState('');

  const handleApprove = async (id: string) => {
    setError('');
    setBusyId(id);
    try {
      await onApprove(id);
    } catch (err) {
      setError(ipcErrorMessage(err, '승인 처리에 실패했습니다.'));
    } finally {
      setBusyId(null);
    }
  };

  const handleReject = async (id: string) => {
    setError('');
    setBusyId(id);
    try {
      await onReject(id);
    } catch (err) {
      setError(ipcErrorMessage(err, '거절 처리에 실패했습니다.'));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <>
      <PageHeader title="승인" subtitle="사람 승인이 필요한 작업을 처리합니다" />
      <div className="page-content">
        {error && (
          <div className="approval-error" role="alert">
            {error}
          </div>
        )}
        {!approvals?.length ? (
          <div className="empty-state">
            <p>대기 중인 승인이 없습니다</p>
          </div>
        ) : (
          approvals.map((a) => (
            <div key={a.id} className="approval-card">
              <h3>{a.title ?? a.reason}</h3>
              <p className="muted">{formatRelativeTime(a.createdAt)}</p>
              <div className="approval-actions">
                <button
                  type="button"
                  className="btn btn-reject"
                  disabled={busyId === a.id}
                  onClick={() => void handleReject(a.id)}
                >
                  거절
                </button>
                <button
                  type="button"
                  className="btn btn-approve"
                  disabled={busyId === a.id}
                  onClick={() => void handleApprove(a.id)}
                >
                  {busyId === a.id ? '처리 중…' : '승인'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
