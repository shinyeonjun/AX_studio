import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  MessagePartPrimitive,
  MessagePrimitive,
  ThreadPrimitive,
  unstable_useComposerInput,
  useExternalStoreRuntime,
  useMessagePartText,
  type AppendMessage,
  type ThreadMessageLike,
} from '@assistant-ui/react';
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { axStudioLogo } from '../../constants/brand';
import { isRunResultMessage, WorkspaceRunResultCard } from './WorkspaceRunResultCard';
import { WorkspaceMarkdown } from './WorkspaceMarkdown';

export interface WorkspaceChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

interface AxWorkspaceChatProps {
  messages: WorkspaceChatMessage[];
  busy: boolean;
  error: string;
  progress: string;
  placeholder?: string;
  slashCommandsEnabled?: boolean;
  onSend: (text: string) => Promise<void>;
}

const WORKSPACE_SLASH_COMMANDS = [
  {
    command: '/once',
    label: '일회 실행',
    description: '업무를 설계한 뒤 한 번만 실행합니다.',
  },
  {
    command: '/workflow',
    label: '반복 업무',
    description: '업무를 저장해 트리거마다 자동 실행합니다.',
  },
] as const;

const WELCOME_EXAMPLES = [
  { label: '일회 실행 예시', text: '/once Slack에 오늘 일정 알려줘' },
  { label: '반복 업무 예시', text: '/workflow Gmail 수신 시 Slack 알림' },
  { label: '연결 확인', text: '연결된 폴더에 어떤 파일이 있어?' },
] as const;

type WorkspaceSlashCommand = (typeof WORKSPACE_SLASH_COMMANDS)[number];

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

function AssistantText() {
  const text = useMessagePartText().text;
  if (isRunResultMessage(text)) {
    return <WorkspaceRunResultCard content={text} />;
  }
  return <WorkspaceMarkdown content={text} />;
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="ax-workspace-message ax-workspace-message--user">
      <div className="ax-workspace-bubble ax-workspace-bubble--user">
        <MessagePrimitive.Content components={{ Text: () => <MessagePartPrimitive.Text /> }} />
      </div>
    </MessagePrimitive.Root>
  );
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="ax-workspace-message ax-workspace-message--assistant">
      <img
        src={axStudioLogo}
        alt=""
        className="ax-workspace-avatar ax-workspace-avatar--assistant"
        aria-hidden="true"
      />
      <div className="ax-workspace-bubble ax-workspace-bubble--assistant">
        <MessagePrimitive.Content components={{ Text: AssistantText }} />
      </div>
    </MessagePrimitive.Root>
  );
}

interface WorkspaceComposerProps {
  busy: boolean;
  placeholder: string;
  slashCommandsEnabled: boolean;
  selectedCommand: WorkspaceSlashCommand['command'] | null;
  onSelectCommand: (command: WorkspaceSlashCommand) => void;
  onClearCommand: () => void;
}

function WorkspaceComposer({
  busy,
  placeholder,
  slashCommandsEnabled,
  selectedCommand,
  onSelectCommand,
  onClearCommand,
}: WorkspaceComposerProps) {
  const disabled = busy;
  const { value, setText } = unstable_useComposerInput({ disabled });
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [activeIndex, setActiveIndex] = useState(0);
  const commandQuery = value.match(/^\/([^\s]*)$/)?.[1]?.toLowerCase() ?? null;
  const commands = commandQuery === null
    ? []
    : WORKSPACE_SLASH_COMMANDS.filter((item) => item.command.slice(1).startsWith(commandQuery));
  const menuOpen = slashCommandsEnabled && !disabled && commandQuery !== null && commands.length > 0;
  const selected = WORKSPACE_SLASH_COMMANDS.find((item) => item.command === selectedCommand);

  useEffect(() => {
    setActiveIndex((current) => Math.min(current, Math.max(commands.length - 1, 0)));
  }, [commands.length, commandQuery]);

  const selectCommand = (index: number) => {
    const item = commands[index];
    if (!item) return;
    onSelectCommand(item);
    setText('');
    requestAnimationFrame(() => {
      inputRef.current?.focus({ preventScroll: true });
      const end = inputRef.current?.value.length ?? 0;
      inputRef.current?.setSelectionRange(end, end);
    });
  };

  const handleKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (!menuOpen) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) => (current + 1) % commands.length);
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => (current - 1 + commands.length) % commands.length);
      return;
    }
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      selectCommand(activeIndex);
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      setText('');
    }
  };

  return (
    <>
      <div className={`ax-workspace-composer-shell${selected ? ' is-mode-selected' : ''}`}>
        {menuOpen && (
          <div
            id="workspace-slash-menu"
            className="ax-workspace-slash-menu"
            role="listbox"
            aria-label="업무 만들기 명령"
            data-testid="workspace-slash-menu"
          >
            <div className="ax-workspace-slash-menu-header">
              <span className="ax-workspace-slash-menu-mark">/</span>
              <span>무엇을 만들까요?</span>
              <span className="ax-workspace-slash-menu-hint">↑↓ 선택 · Enter 확정</span>
            </div>
            {commands.map((item, index) => (
              <button
                key={item.command}
                id={`workspace-slash-option-${item.command.slice(1)}`}
                type="button"
                role="option"
                aria-selected={index === activeIndex}
                className={`ax-workspace-slash-item${index === activeIndex ? ' is-active' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => selectCommand(index)}
              >
                <span className="ax-workspace-slash-command">{item.command}</span>
                <span className="ax-workspace-slash-copy">
                  <strong>{item.label}</strong>
                  <small>{item.description}</small>
                </span>
              </button>
            ))}
          </div>
        )}
        {selected && (
          <div
            className="ax-workspace-composer-mode"
            role="status"
            aria-label={`${selected.label} 모드 선택됨`}
            data-testid="workspace-composer-mode"
          >
            <img src={axStudioLogo} alt="" aria-hidden="true" className="ax-workspace-composer-mode-icon" />
            <span className="ax-workspace-composer-mode-command">{selected.command}</span>
            <span className="ax-workspace-composer-mode-label">{selected.label}</span>
            <span className="ax-workspace-composer-mode-description">{selected.description}</span>
            <button
              type="button"
              className="ax-workspace-composer-mode-clear"
              aria-label={`${selected.label} 모드 해제`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={onClearCommand}
            >
              <span aria-hidden="true">×</span>
            </button>
          </div>
        )}
        <div className="ax-workspace-composer-input-row">
          <ComposerPrimitive.Input
            ref={inputRef}
            placeholder={placeholder}
            disabled={disabled}
            onKeyDown={handleKeyDown}
            aria-autocomplete="list"
            aria-controls={menuOpen ? 'workspace-slash-menu' : undefined}
            aria-activedescendant={menuOpen ? `workspace-slash-option-${commands[activeIndex]?.command.slice(1)}` : undefined}
            aria-expanded={menuOpen}
          />
          <ComposerPrimitive.Send className="ax-workspace-send" disabled={disabled}>
            <svg width="20" height="20" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M8.99992 16V6.41407L5.70696 9.70704C5.31643 10.0976 4.68342 10.0976 4.29289 9.70704C3.90237 9.31652 3.90237 8.6835 4.29289 8.29298L9.29289 3.29298C9.68342 2.90245 10.3164 2.90245 10.7069 3.29298L15.7069 8.29298C16.0975 8.6835 16.0975 8.6835 15.7069 9.70704C15.3164 10.0976 14.6834 10.0976 14.2929 9.70704L10.9999 6.41407V16C10.9999 16.5523 10.5522 17 9.99992 17C9.44764 17 8.99992 16.5523 8.99992 16Z" />
            </svg>
            <span className="ax-workspace-send-label">메시지 보내기</span>
          </ComposerPrimitive.Send>
        </div>
      </div>
    </>
  );
}

export function AxWorkspaceChat({
  messages,
  busy,
  error,
  progress,
  placeholder,
  slashCommandsEnabled = true,
  onSend,
}: AxWorkspaceChatProps) {
  const threadMessages = useMemo(() => toThreadMessages(messages), [messages]);
  const [selectedCommand, setSelectedCommand] = useState<WorkspaceSlashCommand['command'] | null>(null);

  const runtime = useExternalStoreRuntime({
    messages: threadMessages,
    convertMessage: (message) => message,
    // AX Studio owns the visible progress row below. Passing `busy` here
    // makes assistant-ui add a second empty optimistic assistant message.
    onNew: async (message) => {
      const text = appendText(message);
      if (!text) return;
      const commandText = selectedCommand ? `${selectedCommand} ${text}` : text;
      await onSend(commandText);
      setSelectedCommand(null);
    },
  });

  const composerPlaceholder =
    placeholder ??
    (selectedCommand === '/once'
      ? '한 번 실행할 업무를 입력하세요'
      : selectedCommand === '/workflow'
        ? '반복해서 실행할 업무를 입력하세요'
        : '무엇이든 물어보세요');

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className={`ax-workspace-chat${messages.length === 0 && !busy ? ' ax-workspace-chat--empty' : ''}`}>
        <ThreadPrimitive.Root className="ax-workspace-thread">
          {messages.length === 0 && !busy && (
            <div className="ax-workspace-empty-stage">
              <div className="ax-workspace-welcome">
                <h1>무엇을 도와드릴까요?</h1>
                <p className="ax-workspace-welcome-hint">
                  아래 예시를 누르거나 <code>/</code> 로 일회 실행 · 반복 업무를 시작하세요
                </p>
                <div className="ax-workspace-welcome-actions">
                  <button
                    type="button"
                    className="ax-workspace-welcome-chip"
                    onClick={() => setSelectedCommand('/once')}
                  >
                    일회 실행
                  </button>
                  <button
                    type="button"
                    className="ax-workspace-welcome-chip"
                    onClick={() => setSelectedCommand('/workflow')}
                  >
                    반복 업무
                  </button>
                </div>
                <ul className="ax-workspace-example-list">
                  {WELCOME_EXAMPLES.map((example) => (
                    <li key={example.label}>
                      <button
                        type="button"
                        className="ax-workspace-example-btn"
                        onClick={() => void onSend(example.text)}
                      >
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
            <ThreadPrimitive.Messages
              components={{ UserMessage, AssistantMessage }}
            />
            {busy && (
              <div className="ax-workspace-message ax-workspace-message--assistant ax-workspace-typing" aria-live="polite">
                <img
                  src={axStudioLogo}
                  alt=""
                  className="ax-workspace-avatar ax-workspace-avatar--assistant"
                  aria-hidden="true"
                />
                <div className="ax-workspace-typing-content">
                  <span />
                  <span />
                  <span />
                  <p className="muted">{progress || '답변을 준비하고 있습니다'}</p>
                </div>
              </div>
            )}
            {error && (
              <div className="ax-workspace-error" role="alert">
                {error}
              </div>
            )}
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>

        <div className="ax-workspace-footer">
          <ComposerPrimitive.Root className="ax-workspace-composer">
            <WorkspaceComposer
              busy={busy}
              placeholder={composerPlaceholder}
              slashCommandsEnabled={slashCommandsEnabled}
              selectedCommand={selectedCommand}
              onSelectCommand={(command) => setSelectedCommand(command.command)}
              onClearCommand={() => setSelectedCommand(null)}
            />
          </ComposerPrimitive.Root>
        </div>
      </div>
    </AssistantRuntimeProvider>
  );
}
