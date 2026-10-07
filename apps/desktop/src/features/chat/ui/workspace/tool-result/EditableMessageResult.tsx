import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { ToolDraftController } from './draft-controller';
import { MessageDraftFields } from './MessageDraftFields';
import { ToolHeader } from './ToolHeader';
import type { ToolResultPaneProps } from './types';

export function EditableMessageResult({
  controller,
  busy,
  active = true,
  onConfirm,
  onCancel,
}: {
  controller: ToolDraftController;
  busy: boolean;
  active?: boolean;
  onConfirm: ToolResultPaneProps['onConfirm'];
  onCancel: ToolResultPaneProps['onCancel'];
}) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const confirmButton = useRef<HTMLButtonElement>(null);
  const reviewButton = useRef<HTMLButtonElement>(null);
  const focusAfterBack = useRef(false);
  useEffect(() => { if (active) controller.activate(); else controller.dispose(); return () => controller.dispose(); }, [controller, active]);
  useEffect(() => { if (state.phase === 'review') confirmButton.current?.focus(); }, [state.phase]);
  useEffect(() => {
    if (state.phase === 'editing' && focusAfterBack.current) {
      reviewButton.current?.focus();
      focusAfterBack.current = false;
    }
  }, [state.phase]);
  const reviewing = state.phase === 'review';
  const locked = !active || busy || ['sending', 'cancelling', 'sent', 'cancelled', 'unresolved'].includes(state.phase);
  const preparing = state.phase === 'preparing';
  const gmail = state.draft.tool === 'gmail';
  const terminal = ['sent', 'cancelled', 'unresolved'].includes(state.phase);
  const binding = state.review?.binding;
  const source = controller.source;
  const back = () => { focusAfterBack.current = true; controller.back(); };
  return (
    <section className={`tool-result-pane tool-result-pane--${state.draft.tool}`} aria-label={gmail ? 'Gmail 결과 편집' : 'Slack 결과 편집'} aria-busy={preparing || state.phase === 'sending'}
      onKeyDown={event => { if (event.key === 'Escape' && (reviewing || preparing)) { event.preventDefault(); back(); } }}>
      <ToolHeader
        tool={state.draft.tool}
        title={state.draft.tool === 'gmail' ? (state.draft.subject.startsWith('Re:') ? 'Gmail · 답장 초안' : 'Gmail · 메일 초안') : 'Slack · 메시지 초안'}
        badge={state.phase === 'sent' ? '전송 완료' : state.phase === 'cancelled' ? '취소됨' : state.phase === 'cancelling' ? '취소 처리 중'
          : state.phase === 'unresolved' ? '결과 확인 필요' : state.phase === 'sending' ? '전송 처리 중' : '미전송 초안'}
      />
      <p className="tool-result-destination"><span>{gmail ? '보내는 계정' : '워크스페이스 · 보내는 계정'}</span>
        <strong>{binding ? (gmail ? binding.accountLabel : (binding.workspaceLabel ?? binding.workspaceId) + ' · ' + binding.accountLabel) : '전송 전 확인에서 연결 계정 자동 검증'}</strong></p>
      {reviewing && binding && <div className="tool-result-review" role="status"><strong>{gmail ? '이 내용으로 메일을 보낼까요?' : '이 내용으로 Slack에 게시할까요?'}</strong>
        <p>{binding.accountLabel} → {binding.destinationLabel}{binding.provider === 'slack' ? ' (' + binding.destinationId + ')' : ''}</p>
        <small>아직 전송되지 않았습니다. 수정하면 다시 확인합니다.</small></div>}
      <MessageDraftFields
        draft={state.draft}
        locked={locked}
        source={source}
        workspaceLabel={binding?.workspaceLabel}
        onEdit={draft => controller.edit(draft)}
      />
      {source.blockedFields.length > 0 && <p className="tool-result-error" role="alert">지원되지 않는 첨부·스레드 또는 추가 전송 옵션이 있어 전송이 차단되었습니다. 원래 요청은 보존됩니다.</p>}
      {state.error && <p className="tool-result-error" role="alert">{state.error}</p>}
      {state.outcome?.status === 'sent' && <p>서비스 확인 번호: {state.outcome.receiptId}</p>}
      {state.refreshWarning && <p role="status">{state.phase === 'sent' ? '서비스에서 전송 완료를 확인했습니다. ' : ''}{state.persistenceWarning ? '로컬 기록을 저장하지 못했습니다. 다시 보내기 전에 서비스에서 결과를 확인해 주세요.' : '화면 기록을 새로 불러오지 못했습니다.'}</p>}
      <footer className="tool-result-footer">
        <div className="tool-result-footer-left">
          <span className="tool-result-status" role="status">{state.phase === 'sent' ? (gmail ? '메일 발송 완료' : 'Slack 게시 완료')
            : state.phase === 'cancelled' ? '전송 요청 취소됨' : state.phase === 'sending' ? '전송 처리 중 · 취소로 회수할 수 없습니다'
              : state.phase === 'unresolved' ? '서비스에서 결과 확인 필요' : '앱을 다시 시작하면 미전송 수정 내용이 사라집니다'}</span>
        </div>
        {!terminal && <div className="tool-result-actions">
          <button type="button" disabled={locked} onClick={() => void controller.cancel(onCancel)}>요청 취소</button>
          {reviewing ? <><button type="button" disabled={locked} onClick={back}>편집으로 돌아가기</button>
            <button ref={confirmButton} type="button" className="tool-result-primary" disabled={locked} onClick={() => void controller.confirm(onConfirm)}>{gmail ? '확인하고 발송' : '확인하고 게시'}</button></>
            : <button ref={reviewButton} type="button" className="tool-result-primary" disabled={locked || preparing || source.blockedFields.length > 0}
              onClick={() => void controller.review()}>
              {preparing ? '계정과 받는 곳 확인 중…' : gmail ? '발송 전 확인' : '게시 전 확인'}
            </button>}
        </div>}
      </footer>
    </section>
  );
}
