import type { EditableToolResult, MessageToolDraft } from '@ax-studio/core';

export function MessageDraftFields({
  draft,
  locked,
  source,
  workspaceLabel,
  onEdit,
}: {
  draft: MessageToolDraft;
  locked: boolean;
  source: EditableToolResult;
  workspaceLabel?: string;
  onEdit: (draft: MessageToolDraft) => void;
}) {
  // Only controls that change the host-owned draft are rendered. Attachments are not
  // sendable yet, so no attachment chips are shown that could imply otherwise.
  return draft.tool === 'gmail' ? (
    <div className="tool-result-form tool-result-form--gmail">
      <div className="tool-result-field-group">
        <label className="tool-result-field">
          <span>받는 사람</span>
          <input
            aria-label="받는 사람"
            value={draft.to}
            disabled={locked}
            required
            placeholder="받는 사람의 정확한 이메일"
            maxLength={2000}
            onChange={event => onEdit({ ...draft, to: event.target.value })}
          />
        </label>
        <label className="tool-result-field">
          <span>제목</span>
          <input
            aria-label="제목"
            value={draft.subject}
            disabled={locked}
            placeholder="제목 없음"
            maxLength={2000}
            onChange={event => onEdit({ ...draft, subject: event.target.value })}
          />
        </label>
      </div>

      <div className="tool-result-editor-card tool-result-editor-card--gmail">
        <label className="tool-result-editor">
          <span>본문</span>
          <textarea
            aria-label="메일 본문"
            value={draft.body}
            disabled={locked}
            required
            placeholder="내용을 직접 작성할 수 있습니다"
            maxLength={60000}
            onChange={event => onEdit({ ...draft, body: event.target.value })}
          />
        </label>
        <div className="tool-result-attachment-bar">
          <div className="tool-result-attachment-left">
            <span className="tool-result-attachment-icon" aria-hidden="true">📎</span>
            <span className="tool-result-attachment-notice">
              {source.blockedFields.includes('attachments')
                ? '첨부 요청이 보존되어 있습니다. 첨부 전송을 지원하지 않아 이 요청은 전송할 수 없습니다.'
                : '첨부 전송은 아직 지원되지 않습니다.'}
            </span>
          </div>
        </div>
      </div>
    </div>
  ) : (
    <div className="tool-result-form tool-result-form--slack">
      <div className="tool-result-slack-channel-bar">
        <span className="slack-channel-icon" aria-hidden="true">✏️</span>
        <div className="slack-channel-path-wrap">
          {workspaceLabel ? <span className="slack-channel-path-prefix">{workspaceLabel} / </span> : null}
          <input
            aria-label="Slack 채널"
            value={draft.channel}
            disabled={locked}
            required
            placeholder="정확한 채널 이름 또는 ID"
            maxLength={2000}
            onChange={event => onEdit({ ...draft, channel: event.target.value })}
            className="slack-channel-input"
          />
        </div>
      </div>
      <div className="tool-result-thread">
        <strong>{source.threadReference ? '스레드 답글 요청' : '새 채널 메시지'}</strong>
        <span>{source.threadReference ? '대상 ' + source.threadReference + ' · 스레드 전송 미지원' : '스레드 답장과 파일 게시 미지원'}</span>
      </div>

      <div className="tool-result-editor-card tool-result-editor-card--slack">
        <label className="tool-result-editor">
          <span>메시지</span>
          <textarea
            aria-label="Slack 메시지"
            value={draft.text}
            disabled={locked}
            required
            placeholder="메시지를 직접 작성할 수 있습니다"
            maxLength={60000}
            onChange={event => onEdit({ ...draft, text: event.target.value })}
          />
        </label>
      </div>
    </div>
  );
}
