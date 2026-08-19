import { useEffect, useRef } from 'react';
import type { InterviewState } from '../../hooks/useInterview';

interface ChatPageProps {
  interview: InterviewState | null;
  saved: boolean;
  busy: boolean;
  error: string;
  progress: string;
  instruction: string;
  answer: string;
  onInstructionChange: (value: string) => void;
  onAnswerChange: (value: string) => void;
  onStartInterview: () => void;
  onSendAnswer: () => void;
  onTestRun: () => void;
  onSaveAndRun: () => void;
}

function SendIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
      <path d="M22 2 11 13" />
      <path d="M22 2 15 22 11 13 2 9 22 2z" />
    </svg>
  );
}

export function ChatPage({
  interview,
  busy,
  error,
  progress,
  instruction,
  answer,
  onInstructionChange,
  onAnswerChange,
  onStartInterview,
  onSendAnswer,
  onTestRun,
  onSaveAndRun,
}: ChatPageProps) {
  const threadRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const inConversation = Boolean(interview);
  const finished = Boolean(interview?.done);
  const composerValue = inConversation ? answer : instruction;
  const canSend = composerValue.trim().length > 0 && !busy && !finished;

  const setComposerValue = (value: string) => {
    if (inConversation) onAnswerChange(value);
    else onInstructionChange(value);
  };

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
                  <div className="chat-actions">
                    <button type="button" className="btn" onClick={onTestRun}>
                      테스트 실행
                    </button>
                    <button type="button" className="btn btn-primary" onClick={onSaveAndRun}>
                      이대로 맡기기
                    </button>
                  </div>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {!finished && (
        <div className="chat-composer-wrap">
          <div className="chat-composer">
            <textarea
              ref={inputRef}
              rows={1}
              placeholder="메시지..."
              value={composerValue}
              onChange={(e) => setComposerValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  submit();
                }
              }}
              disabled={busy}
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
      )}
    </div>
  );
}
