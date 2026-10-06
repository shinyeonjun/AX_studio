import { useEffect, useState } from 'react';
import type { ToolSendOutcome } from '@ax-studio/core';
import type { AppState } from '../../../../types/app-state';
import { EditableMessageResult } from '../../../chat/ui/workspace/tool-result/ToolResultPane';
import { cachedToolDraft, toolDraftError, type ToolDraftController } from '../../../chat/ui/workspace/tool-result/draft-controller';
import { ApprovalTruncationNote } from './approval-truncation-note';

interface ToolAwareApprovalProps {
  approval: AppState['approvals'][number];
  busy: boolean;
  onLegacyAction: (id: string, action: 'approve' | 'reject') => Promise<void>;
  onRefresh: () => Promise<void>;
  onOutcome: (outcome: ToolSendOutcome, refreshWarning?: boolean) => void;
}

/** Existing approvals keep their route; eligible message sends require the same sealed editor as chat. */
export function ToolAwareApproval({ approval, busy, onLegacyAction, onRefresh, onOutcome }: ToolAwareApprovalProps) {
  const [view, setView] = useState<{ controller?: ToolDraftController; legacy?: boolean; error?: string }>({});
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    let current = true;
    let sequence = 0;
    const load = async () => {
      const request = ++sequence;
      try {
        const data = await window.ax.getToolResult(approval.id);
        if (!current || request !== sequence) return;
        if (data.source?.approvalId === approval.id) setView({ controller: cachedToolDraft(data.source, { update: window.ax.updateToolDraft, review: window.ax.reviewToolResult }) });
        else if (data.outcome) { onOutcome(data.outcome, data.refreshWarning); setView({ error: '이 요청의 처리 결과를 아래에서 확인할 수 있습니다.' }); }
        else if (data.cancelled || data.processing) setView({ error: data.cancelled ? '요청이 취소됐습니다.' : '전송 처리 중입니다. 중복 요청을 보내지 마세요.' });
        else if (data.requiresReview) setView({ error: '이 전송은 편집 가능한 결과 확인이 필요합니다. 원래 요청을 불러오지 못해 전송할 수 없습니다.' });
        else setView({ legacy: true });
      } catch (error) {
        if (current && request === sequence) setView({ error: toolDraftError(error) });
      }
    };
    void load();
    const stop = window.ax.onStateChanged(() => { void load(); });
    return () => { current = false; stop(); };
  }, [approval.id, retry, onOutcome]);

  if (view.controller) return <article className="approval-card approval-card--tool-result">
    <EditableMessageResult controller={view.controller} busy={busy}
      onConfirm={async confirmation => {
        const result = await window.ax.confirmToolResult(confirmation);
        let refreshWarning = result.refreshWarning;
        try { await onRefresh(); }
        catch { refreshWarning = true; }
        if (result.toolSendOutcome) onOutcome(result.toolSendOutcome, refreshWarning);
        return { ...result, ...(refreshWarning ? { refreshWarning } : {}) };
      }}
      onCancel={async id => {
        await window.ax.reject(id);
        try { await onRefresh(); } catch { /* Cancellation already committed. */ }
      }} />
  </article>;

  return <article className="approval-card">
    <h3>{approval.title ?? approval.reason}</h3>
    <p className="muted">{approval.reason}</p>
    <ApprovalTruncationNote approval={approval} />
    {!view.legacy && <p role="status">{view.error ?? '요청의 실제 전송 정보를 불러오는 중…'}</p>}
    <div className="approval-actions">
      {view.legacy && <button type="button" className="btn btn-approve" disabled={busy}
        onClick={() => void onLegacyAction(approval.id, 'approve')}>{busy ? '처리 중…' : '승인'}</button>}
      {view.error && <button type="button" className="btn btn-ghost" disabled={busy} onClick={() => setRetry(value => value + 1)}>다시 불러오기</button>}
      <button type="button" className="btn btn-reject" disabled={busy}
        onClick={() => void onLegacyAction(approval.id, 'reject')}>요청 취소</button>
    </div>
  </article>;
}
