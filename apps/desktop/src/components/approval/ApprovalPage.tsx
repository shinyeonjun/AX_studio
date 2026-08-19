import type { AppState } from '../../types/app-state';
import { PageHeader } from '../layout/PageHeader';

interface ApprovalPageProps {
  approvals: AppState['approvals'];
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
}

export function ApprovalPage({ approvals, onApprove, onReject }: ApprovalPageProps) {
  return (
    <>
      <PageHeader title="승인" subtitle="사람 승인이 필요한 작업을 처리합니다" />
      <div className="page-content">
        {!approvals?.length ? (
          <div className="empty-state">
            <p>대기 중인 승인이 없습니다</p>
          </div>
        ) : (
          approvals.map((a) => (
            <div key={a.id} className="approval-card">
              <h3>{a.reason}</h3>
              <p className="muted">{a.createdAt} · {a.actionIds.join(', ')}</p>
              <div className="approval-actions">
                <button type="button" className="btn btn-reject" onClick={() => onReject(a.id)}>
                  거절
                </button>
                <button type="button" className="btn btn-approve" onClick={() => onApprove(a.id)}>
                  승인
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </>
  );
}
