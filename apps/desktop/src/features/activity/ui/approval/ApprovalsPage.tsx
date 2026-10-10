import { useCallback, useState } from 'react';
import type { ToolSendOutcome } from '@ax-studio/core';
import type { AppState } from '../../../../types/app-state';
import { ipcErrorMessage } from '../../../../ui/lib/ipc-error';
import { PageHeader } from '../../../../ui/layout/PageHeader';
import { ToolAwareApproval } from './ToolAwareApproval';
import { OutcomeResult } from '../../../chat/ui/workspace/tool-result/ToolResultPane';

interface ApprovalsPageProps {
  state: AppState | null;
  onRefresh: () => Promise<void>;
  onApprove: (id: string) => Promise<void>;
  onReject: (id: string) => Promise<void>;
}

export function ApprovalsPage({ state, onRefresh, onApprove, onReject }: ApprovalsPageProps) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const [lastOutcome, setLastOutcome] = useState<{ outcome: ToolSendOutcome; refreshWarning?: boolean }>();
  const recordOutcome = useCallback((outcome: ToolSendOutcome, refreshWarning?: boolean) => setLastOutcome({ outcome, refreshWarning }), []);

  const approvals = state?.approvals ?? [];

  const runAction = async (id: string, action: 'approve' | 'reject') => {
    setBusyId(id);
    setActionError('');
    try {
      if (action === 'approve') await onApprove(id);
      else await onReject(id);
    } catch (error) {
      setActionError(ipcErrorMessage(error, '승인 처리에 실패했습니다.'));
      setBusyId(null);
      return;
    }
    // The action already committed; a failed refresh must not be reported as a failed approval.
    try {
      await onRefresh();
    } catch {
      setActionError('처리는 완료됐지만 최신 상태를 불러오지 못했습니다. 잠시 후 새로고침해 주세요.');
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
      <div className="page-content approvals-page">
        {actionError && (
          <div className="approval-error" role="alert">
            {actionError}
          </div>
        )}
        {lastOutcome && <OutcomeResult {...lastOutcome} />}

        {approvals.length === 0 ? (
          <div className="empty-state">
            <p>대기 중인 승인이 없습니다</p>
            <p className="muted">
              업무 실행 중 외부 전송이나 고위험 작업이 필요하면 여기에 표시됩니다.
            </p>
          </div>
        ) : (<>
          <p className="approvals-count">확인을 기다리는 요청 {approvals.length}건</p>
          {approvals.map(approval => <ToolAwareApproval key={approval.id} approval={approval} busy={busyId === approval.id}
            onLegacyAction={runAction} onRefresh={onRefresh} onOutcome={recordOutcome} />)}
        </>)}
      </div>
    </>
  );
}
