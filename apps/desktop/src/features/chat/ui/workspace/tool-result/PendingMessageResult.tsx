import { useEffect, useState } from 'react';
import type { ToolResultReference, ToolSendOutcome } from '@ax-studio/core';
import { cachedToolDraft, type ToolDraftController, toolDraftError } from './draft-controller';
import { EditableMessageResult } from './EditableMessageResult';
import { OutcomeResult } from './OutcomeResult';
import { ToolHeader } from './ToolHeader';
import type { ToolResultPaneProps } from './types';

export function PendingMessageResult({ reference, ...actions }: { reference: ToolResultReference } & Omit<ToolResultPaneProps, 'message'>) {
  const [view, setView] = useState<{ controller?: ToolDraftController; outcome?: ToolSendOutcome; refreshWarning?: boolean; persistenceWarning?: boolean; message?: string }>({});
  useEffect(() => {
    let current = true;
    let loadSequence = 0;
    const load = async () => {
      const sequence = ++loadSequence;
      try {
        const data = await window.ax.getToolResult(reference.approvalId);
        if (!current || sequence !== loadSequence) return;
        if (data.outcome) setView(previous => previous.controller && ['sending', 'sent'].includes(previous.controller.getSnapshot().phase)
          ? previous : { outcome: data.outcome, refreshWarning: data.refreshWarning, persistenceWarning: data.persistenceWarning });
        else if (data.source && data.source.approvalId === reference.approvalId && data.source.workspaceSessionId === reference.workspaceSessionId
          && data.source.tool === reference.tool) setView({ controller: cachedToolDraft(data.source, { update: window.ax.updateToolDraft, review: window.ax.reviewToolResult }) });
        else setView({ message: data.cancelled ? '전송 요청이 취소되었습니다.' : data.processing ? '전송 처리 중입니다. 취소로 전송을 회수할 수 없습니다.' : '이 요청은 이미 처리되었습니다. 활동에서 결과를 확인해 주세요.' });
      } catch (error) { if (current && sequence === loadSequence) setView({ message: toolDraftError(error) }); }
    };
    void load();
    const stop = window.ax.onStateChanged(() => { void load(); });
    return () => { current = false; stop(); };
  }, [reference.approvalId, reference.workspaceSessionId, reference.tool]);

  if (view.outcome) return <OutcomeResult outcome={view.outcome} refreshWarning={view.refreshWarning} persistenceWarning={view.persistenceWarning} executionId={reference.executionId} />;
  if (view.controller) return <EditableMessageResult controller={view.controller} {...actions} />;
  return <section className="tool-result-pane" aria-label="결과 불러오기"><ToolHeader tool={reference.tool} title={reference.tool === 'gmail' ? 'Gmail · 메일 초안' : 'Slack · 메시지 초안'} />
    <p role="status">{view.message ?? '기존 초안을 불러오는 중…'}</p></section>;
}
