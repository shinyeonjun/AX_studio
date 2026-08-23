import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
  type AppendMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { useMemo, useRef } from 'react';
import type { DiscoveryInspectView } from '@ax-studio/core';
import type { AxInputRequest, AxUiPresentation } from '@ax-studio/core';
import { axStudioLogo } from '../../constants/brand';
import { isRunResultMessage, WorkspaceRunResultCard } from './WorkspaceRunResultCard';
import { WorkspaceMarkdown } from './WorkspaceMarkdown';
import { WorkspaceAssistantPresentation } from './WorkspaceAssistantPresentation';
import { DiscoveryReviewCard } from './DiscoveryReviewCard';

export interface WorkspaceChatMessage {
  role: 'user' | 'assistant';
  content: string;
  inputRequests?: AxInputRequest[];
  presentations?: AxUiPresentation[];
}

interface AxWorkspaceChatProps {
  messages: WorkspaceChatMessage[];
  busy: boolean;
  error: string;
  progress: string;
  placeholder?: string;
  workflowId?: string;
  workflowRegistered?: boolean;
  discoveryView?: DiscoveryInspectView;
  discoveryBusy?: boolean;
  onSend: (text: string) => Promise<void>;
  onRegisterWorkflow?: () => Promise<void>;
  onAttachExample?: () => Promise<void>;
  onDiscoveryAnswer?: (questionId: string, optionId: string) => Promise<void> | void;
  onDiscoveryPublish?: () => Promise<void> | void;
}

const WELCOME_EXAMPLES: Array<{ label: string; text: string }> = [
  { label: '말로 만들기', text: 'Gmail 새 메일이 오면 내용을 요약해서 Slack으로 알려주는 반복 업무를 만들어줘' },
  { label: '연결 확인', text: '연결된 폴더에 어떤 파일이 있어?' },
];

function toThreadMessages(messages: WorkspaceChatMessage[]): ThreadMessageLike[] {
  return messages.map((message, index) => ({
    id: `ax-msg-${index}`,
    role: message.role,
    content: [{ type: 'text' as const, text: message.content }],
  }));
}

function appendText(message: AppendMessage): string {
  return message.content
    .filter((part): part is Extract<typeof part, { type: 'text' }> => part.type === 'text')
    .map((part) => part.text)
    .join('')
    .trim();
}

function UserMessage({ message }: { message: WorkspaceChatMessage }) {
  return (
    <div className="ax-workspace-message ax-workspace-message--user">
      <div className="ax-workspace-bubble ax-workspace-bubble--user">{message.content}</div>
    </div>
  );
}

function AssistantMessage({
  message,
  busy,
  onSend,
}: {
  message: WorkspaceChatMessage;
  busy: boolean;
  onSend: (text: string) => Promise<void>;
}) {
  const content = isRunResultMessage(message.content)
    ? <WorkspaceRunResultCard content={message.content} />
    : <WorkspaceMarkdown content={message.content} />;

  return (
    <div className="ax-workspace-message ax-workspace-message--assistant">
      <img src={axStudioLogo} alt="" className="ax-workspace-avatar ax-workspace-avatar--assistant" aria-hidden="true" />
      <div className="ax-workspace-bubble ax-workspace-bubble--assistant">
        {content}
        <WorkspaceAssistantPresentation
          presentations={message.presentations}
          inputRequests={message.inputRequests}
          busy={busy}
          onSend={onSend}
        />
      </div>
    </div>
  );
}

interface WorkspaceComposerProps {
  busy: boolean;
  placeholder: string;
}

function WorkspaceComposer({
  busy,
  placeholder,
}: WorkspaceComposerProps) {
  const disabled = busy;
  const inputRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div className="ax-workspace-composer-shell">
      <div className="ax-workspace-composer-input-row">
        <ComposerPrimitive.Input ref={inputRef} placeholder={placeholder} disabled={disabled} aria-label="메시지 입력" />
        <ComposerPrimitive.Send className="ax-workspace-send" disabled={disabled}>
          <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
            <path d="M8.99992 16V6.41407L5.70696 9.70704C5.31643 10.0976 4.68342 10.0976 4.29289 9.70704C3.90237 9.31652 3.90237 8.6835 4.29289 8.29298L9.29289 3.29298C9.68342 2.90245 10.3164 2.90245 10.7069 3.29298L15.7069 8.29298C16.0975 9.31652 15.3164 10.0976 14.2929 9.70704L10.9999 6.41407V16C10.9999 16.5523 10.5522 17 9.99992 17C9.44764 17 8.99992 16.5523 8.99992 16Z" />
          </svg>
          <span className="ax-workspace-send-label">메시지 보내기</span>
        </ComposerPrimitive.Send>
      </div>
    </div>
  );
}

export function AxWorkspaceChat({
  messages,
  busy,
  error,
  progress,
  placeholder,
  workflowId,
  workflowRegistered = false,
  discoveryView,
  discoveryBusy = false,
  onSend,
  onRegisterWorkflow,
  onAttachExample,
  onDiscoveryAnswer,
  onDiscoveryPublish,
}: AxWorkspaceChatProps) {
  const threadMessages = useMemo(() => toThreadMessages(messages), [messages]);

  const runtime = useExternalStoreRuntime({
    messages: threadMessages,
    convertMessage: (message) => message,
    onNew: async (message) => {
      const text = appendText(message);
      if (!text) return;
      await onSend(text);
    },
  });

  const composerPlaceholder = placeholder ?? '지난 결과물을 보여주거나, 하고 싶은 일을 적어주세요';

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className={`ax-workspace-chat${messages.length === 0 && !busy ? ' ax-workspace-chat--empty' : ''}`}>
        <ThreadPrimitive.Root className="ax-workspace-thread">
          {messages.length === 0 && !busy && (
            <div className="ax-workspace-empty-stage">
              <div className="ax-workspace-welcome">
                <h1>지난 결과물을 보여주세요</h1>
                <p className="ax-workspace-welcome-hint">
                  지난번에 만든 보고서나 표를 첨부하면, 연결된 데이터에서 만드는 법을 찾아 재현해 드립니다.
                </p>
                {onAttachExample && (
                  <button
                    type="button"
                    className="ax-workspace-attach-btn"
                    disabled={discoveryBusy}
                    onClick={() => void onAttachExample()}
                  >
                    지난 결과물 첨부하기
                  </button>
                )}
                <p className="ax-workspace-welcome-hint">또는 아래처럼 말로 요청할 수도 있어요.</p>
                <ul className="ax-workspace-example-list">
                  {WELCOME_EXAMPLES.map((example) => (
                    <li key={example.label}>
                      <button type="button" className="ax-workspace-example-btn" onClick={() => void onSend(example.text)}>
                        <span className="ax-workspace-example-label">{example.label}</span>
                        <span className="ax-workspace-example-text">{example.text}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          <ThreadPrimitive.Viewport autoScroll className="ax-workspace-viewport">
            {messages.map((message, index) => message.role === 'user' ? (
              <UserMessage key={`user-${index}`} message={message} />
            ) : (
              <AssistantMessage
                key={`assistant-${index}`}
                message={message}
                busy={busy}
                onSend={onSend}
              />
            ))}
            {busy && (
              <div className="ax-workspace-message ax-workspace-message--assistant ax-workspace-typing" aria-live="polite">
                <img src={axStudioLogo} alt="" className="ax-workspace-avatar ax-workspace-avatar--assistant" aria-hidden="true" />
                <div className="ax-workspace-typing-content"><span /><span /><span /><p className="muted">{progress || '답변을 준비하고 있습니다'}</p></div>
              </div>
            )}
            {error && <div className="ax-workspace-error" role="alert">{error}</div>}
            {discoveryView && onDiscoveryAnswer && onDiscoveryPublish && (
              <DiscoveryReviewCard
                view={discoveryView}
                busy={discoveryBusy}
                onAnswer={onDiscoveryAnswer}
                onPublish={onDiscoveryPublish}
              />
            )}
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>

        <div className="ax-workspace-footer">
          {workflowId && onRegisterWorkflow && (
            <button
              type="button"
              className="ax-workspace-register-button"
              disabled={busy || workflowRegistered}
              onClick={() => void onRegisterWorkflow()}
            >
              {workflowRegistered ? '워크플로우 등록됨' : '워크플로우 등록'}
            </button>
          )}
          <ComposerPrimitive.Root className="ax-workspace-composer">
            <WorkspaceComposer
              busy={busy}
              placeholder={composerPlaceholder}
            />
          </ComposerPrimitive.Root>
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}
