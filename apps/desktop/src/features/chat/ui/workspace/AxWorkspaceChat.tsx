import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import type { ThreadMessageLike } from '@assistant-ui/react';
import { memo, useCallback, useMemo, useState } from 'react';
import type {
  DiscoveryInspectView,
  WorkspaceChatMessage,
} from '@ax-studio/core';
import type { GeneratedArtifactExportResult } from '../../../../types/ax-api/contracts';
import { AssistantMessage, UserMessage } from './ax-workspace-chat/messages';
import { appendText, toThreadMessages } from './ax-workspace-chat/model';
import { WorkspaceComposer } from './ax-workspace-chat/composer';
import {
  WorkspaceDiscoveryState,
  WorkspaceEmptyStage,
  WorkspaceErrorState,
  WorkspaceTypingState,
} from './ax-workspace-chat/states';

interface AxWorkspaceChatProps {
  messages: WorkspaceChatMessage[];
  busy: boolean;
  error: string;
  progress: string;
  placeholder?: string;
  workflowId?: string;
  /** Name of the opened saved work, for its empty screen. */
  workflowTitle?: string;
  resumableDiscoveries?: ReadonlyArray<{ sessionId: string; goal: string }>;
  onResumeDiscovery?: (sessionId: string) => void;
  workflowRegistered?: boolean;
  discoveryView?: DiscoveryInspectView;
  discoveryBusy?: boolean;
  onSend: (text: string) => Promise<void>;
  onApproveApproval?: (approvalId: string) => Promise<void>;
  onRejectApproval?: (approvalId: string) => Promise<void>;
  onDownloadPdf?: (artifactId: string) => Promise<GeneratedArtifactExportResult>;
  onSavePdfToFolder?: (artifactId: string) => Promise<GeneratedArtifactExportResult>;
  onMakeRecurring?: (source: { executionId: string } | { latestRead: true }, scheduleValue: string) => Promise<void>;
  onDismissError?: () => void;
  onRegisterWorkflow?: () => Promise<void>;
  /** Runs the opened manual work now. */
  onRunWorkflow?: () => Promise<void>;
  onAttachExample?: () => Promise<void>;
  onDiscoveryAnswer?: (questionId: string, optionId: string) => Promise<void> | void;
  onDiscoveryPublish?: () => Promise<void> | void;
  onDiscoveryCancel?: () => Promise<void> | void;
  onDiscoveryRetry?: () => Promise<void> | void;
}

interface WorkspaceMessageListProps {
  messages: WorkspaceChatMessage[];
  busy: boolean;
  lastAssistantIndex: number;
  onSend: (text: string) => Promise<void>;
  onApproveApproval?: (approvalId: string) => Promise<void>;
  onRejectApproval?: (approvalId: string) => Promise<void>;
  onDownloadPdf?: (artifactId: string) => Promise<GeneratedArtifactExportResult>;
  onSavePdfToFolder?: (artifactId: string) => Promise<GeneratedArtifactExportResult>;
  onMakeRecurring?: (source: { executionId: string } | { latestRead: true }, scheduleValue: string) => Promise<void>;
}

const WorkspaceMessageList = memo(function WorkspaceMessageList({
  messages,
  busy,
  lastAssistantIndex,
  onSend,
  onApproveApproval,
  onRejectApproval,
  onDownloadPdf,
  onSavePdfToFolder,
  onMakeRecurring,
}: WorkspaceMessageListProps) {
  const latestReadIndex = useMemo(() => {
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      if (messages[index]!.role === 'assistant' && messages[index]!.readResult) return index;
    }
    return -1;
  }, [messages]);
  return messages.map((message, index) => message.role === 'user' ? (
    <UserMessage key={'user-' + index} message={message} />
  ) : (
    <AssistantMessage
      key={'assistant-' + index}
      message={message}
      busy={busy}
      isLatest={index === lastAssistantIndex}
      onSend={onSend}
      onApproveApproval={onApproveApproval}
      onRejectApproval={onRejectApproval}
      onDownloadPdf={onDownloadPdf}
      onSavePdfToFolder={onSavePdfToFolder}
      onMakeRecurring={onMakeRecurring}
      isLatestRead={index === latestReadIndex}
    />
  ));
});

export function AxWorkspaceChat({
  messages,
  busy,
  error,
  progress,
  placeholder,
  workflowId,
  workflowTitle,
  resumableDiscoveries,
  onResumeDiscovery,
  workflowRegistered = false,
  discoveryView,
  discoveryBusy = false,
  onSend,
  onApproveApproval,
  onRejectApproval,
  onDownloadPdf,
  onSavePdfToFolder,
  onMakeRecurring,
  onDismissError,
  onRegisterWorkflow,
  onRunWorkflow,
  onAttachExample,
  onDiscoveryAnswer,
  onDiscoveryPublish,
  onDiscoveryCancel,
  onDiscoveryRetry,
}: AxWorkspaceChatProps) {
  const [running, setRunning] = useState(false);
  const threadMessages = useMemo(() => toThreadMessages(messages), [messages]);
  // Interactivity follows the newest assistant message, not the newest message:
  // a failed send leaves the optimistic user message last, and the confirm
  // card before it must stay usable for retry.
  const lastAssistantIndex = useMemo(() => messages.reduce(
    (latest, message, index) => (message.role === 'assistant' ? index : latest),
    -1,
  ), [messages]);
  const convertMessage = useCallback((message: ThreadMessageLike) => message, []);
  const handleNewMessage = useCallback(async (message: Parameters<typeof appendText>[0]) => {
    const text = appendText(message);
    if (text) await onSend(text);
  }, [onSend]);
  const runtime = useExternalStoreRuntime({
    messages: threadMessages,
    convertMessage,
    onNew: handleNewMessage,
  });
  const composerPlaceholder = placeholder ?? '지난 결과물을 보여주거나, 하고 싶은 일을 적어주세요';

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <div className={'ax-workspace-chat' + (messages.length === 0 && !busy ? ' ax-workspace-chat--empty' : '')}>
        <ThreadPrimitive.Root className="ax-workspace-thread">
          {messages.length === 0 && !busy && !discoveryView && (
            <WorkspaceEmptyStage
              discoveryBusy={discoveryBusy}
              openWorkName={workflowId ? workflowTitle ?? '' : undefined}
              resumable={resumableDiscoveries}
              onResume={onResumeDiscovery}
              onAttachExample={onAttachExample}
              onSend={onSend}
            />
          )}
          <ThreadPrimitive.Viewport autoScroll className="ax-workspace-viewport">
            <WorkspaceMessageList
              messages={messages}
              busy={busy}
              lastAssistantIndex={lastAssistantIndex}
              onSend={onSend}
              onApproveApproval={onApproveApproval}
              onRejectApproval={onRejectApproval}
              onDownloadPdf={onDownloadPdf}
              onSavePdfToFolder={onSavePdfToFolder}
              onMakeRecurring={onMakeRecurring}
            />
            {busy && <WorkspaceTypingState progress={progress} />}
            {error && <WorkspaceErrorState error={error} onDismissError={onDismissError} />}
            {discoveryView && onDiscoveryAnswer && onDiscoveryPublish && (
              <WorkspaceDiscoveryState
                view={discoveryView}
                busy={discoveryBusy}
                onAnswer={onDiscoveryAnswer}
                onPublish={onDiscoveryPublish}
                onCancel={onDiscoveryCancel}
                onRetry={onDiscoveryRetry}
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
              {workflowRegistered ? '자동 실행 중' : '자동 실행 켜기'}
            </button>
          )}
          {workflowId && onRunWorkflow && (
            <button
              type="button"
              className="ax-workspace-register-button"
              disabled={busy || running}
              onClick={() => {
                setRunning(true);
                void onRunWorkflow().finally(() => setRunning(false));
              }}
            >
              {running ? '실행 중…' : '지금 실행'}
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
