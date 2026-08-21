import { useEffect, useRef } from 'react';
import type { InterviewState } from '../../hooks/interview-helpers';
import type { WorkScope } from '@ax-studio/core';
import { WorkScopeSwitch } from './WorkScopeSwitch';

interface ChatPanelProps {
  interview: InterviewState | null;
  busy: boolean;
  error: string;
  progress: string;
  composerText: string;
  editHint: string | null;
  isLinkedWork: boolean;
  isImmediateOnce: boolean;
  isDeferredOnce: boolean;
  isRecurringDraft: boolean;
  reviewReady: boolean;
  workScope: WorkScope;
  workScopeLocked: boolean;
  onWorkScopeChange: (value: WorkScope) => void;
  onComposerChange: (value: string) => void;
  onClearEditHint: () => void;
  onStartInterview: () => void;
  onSendAnswer: () => void;
  onRunOnce: () => void;
  onSaveAsWork: () => void;
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22 11 13 2 9 22 2z" />
    </svg>
  );
}

export function ChatPanel({
  interview,
  busy,
  error,
  progress,
  composerText,
  editHint,
  isLinkedWork,
  isImmediateOnce,
  isDeferredOnce,
  isRecurringDraft,
  reviewReady,
  workScope,
  workScopeLocked,
  onWorkScopeChange,
  onComposerChange,
  onClearEditHint,
  onStartInterview,
  onSendAnswer,
  onRunOnce,
  onSaveAsWork,
}: ChatPanelProps) {
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const inConversation = Boolean(interview);
  const finished = Boolean(interview?.done);
  const canSend = composerText.trim().length > 0 && !busy && !reviewReady;

  const submit = () => {
    if (!canSend) return;
    if (inConversation) onSendAnswer();
    else onStartInterview();
  };

  useEffect(() => {
    const el = threadRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [interview?.messages, busy, error, progress, interview?.summary, finished]);

  useEffect(() => {
    if (!busy) inputRef.current?.focus();
  }, [busy, inConversation, finished]);

  return (
    <div className="chat-view">
      <div className="chat-thread" ref={threadRef}>
        <div className="chat-thread-inner">
          {!inConversation && (
            <div className="chat-welcome">
              <p>맡기고 싶은 업무를 말씀해주세요.</p>
              <p className="muted">오른쪽에서 AX가 만드는 업무 흐름을 실시간으로 확인할 수 있어요.</p>
            </div>
          )}

          {interview?.messages?.map((m, i) => (
            <div key={i} className={`chat-turn chat-turn-${m.role}`}>
              <div className="chat-turn-avatar" aria-hidden="true">
                {m.role === 'user' ? '나' : 'AX'}
              </div>
              <div className="chat-turn-body">
                <div className="chat-turn-content">{m.content}</div>
              </div>
            </div>
          ))}

          {busy && (
            <div className="chat-turn chat-turn-assistant">
              <div className="chat-turn-avatar" aria-hidden="true">AX</div>
              <div className="chat-turn-body">
                <div className="chat-turn-content chat-typing" aria-live="polite">
                  <span /><span /><span />
                </div>
                <p className="muted chat-typing-label">{progress || '답변을 준비하고 있습니다'}</p>
              </div>
            </div>
          )}

          {error && (
            <div className="chat-turn chat-turn-assistant">
              <div className="chat-turn-avatar" aria-hidden="true">AX</div>
              <div className="chat-turn-body">
                <div className="chat-turn-content chat-turn-error">{error}</div>
              </div>
            </div>
          )}

          {finished && interview?.summary && (
            <div className="chat-turn chat-turn-assistant">
              <div className="chat-turn-avatar" aria-hidden="true">AX</div>
              <div className="chat-turn-body">
                <div className="chat-turn-content">
                  <div className="chat-summary">{interview.summary}</div>
                  {isLinkedWork && (
                    <div className="chat-actions">
                      <button type="button" className="btn btn-primary" onClick={onRunOnce} disabled={busy}>
                        지금 실행
                      </button>
                    </div>
                  )}
                  <p className="muted chat-actions-hint">
                    {isLinkedWork
                      ? '수정은 대화 또는 그래프에서 노드를 선택해 요청하세요.'
                      : '아래 검토 영역에서 흐름을 확인한 뒤 맡길 수 있습니다.'}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div className="chat-composer-wrap">
        {!inConversation && (
          <div className="chat-composer-toolbar">
            <WorkScopeSwitch
              value={workScope}
              disabled={workScopeLocked}
              onChange={onWorkScopeChange}
            />
            <span className="chat-composer-scope-hint">
              {workScope === 'once' ? '지금 한 번 실행' : '이벤트·반복으로 자동 실행'}
            </span>
          </div>
        )}
        {editHint && (
          <div className="chat-edit-hint">
            <span>{editHint}</span>
            <button type="button" className="btn btn-sm btn-ghost" onClick={onClearEditHint}>
              취소
            </button>
          </div>
        )}
        <div className="chat-composer">
          <textarea
            ref={inputRef}
            rows={1}
            placeholder={
              reviewReady
                ? '아래 버튼으로 실행하거나 저장하세요'
                : finished
                  ? '수정 요청을 입력하세요'
                  : '메시지 보내기'
            }
            value={composerText}
            onChange={(e) => onComposerChange(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            disabled={busy || reviewReady}
          />
          <button
            type="button"
            className="chat-send"
            onClick={submit}
            disabled={!canSend}
            aria-label="보내기"
          >
            <SendIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
