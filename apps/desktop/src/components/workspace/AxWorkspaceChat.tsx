import {
  AssistantRuntimeProvider,
  ComposerPrimitive,
  ThreadPrimitive,
  useExternalStoreRuntime,
} from '@assistant-ui/react';
import { useMemo } from 'react';
import type {
  DiscoveryInspectView,
  WorkspaceChatMessage,
} from '@ax-studio/core';
import type { GeneratedArtifactExportResult } from '../../types/ax-api/contracts';
import { AssistantMessage, UserMessage } from './ax-workspace-chat/messages';
import { appendText, toThreadMessages } from './ax-workspace-chat/model';
import { WorkspaceComposer } from './ax-workspace-chat/composer';
import {
  WorkspaceDiscoveryState,
  WorkspaceEmptyStage,
  WorkspaceErrorState,
  WorkspaceTypingState,
} from './ax-workspace-chat/states';

export type { WorkspaceChatMessage } from '@ax-studio/core';

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
  onApproveApproval?: (approvalId: string) => Promise<void>;
  onRejectApproval?: (approvalId: string) => Promise<void>;
  onDownloadPdf?: (artifactId: string) => Promise<GeneratedArtifactExportResult>;
  onSavePdfToFolder?: (artifactId: string) => Promise<GeneratedArtifactExportResult>;
  onDismissError?: () => void;
  onRegisterWorkflow?: () => Promise<void>;
  onAttachExample?: () => Promise<void>;
  onDiscoveryAnswer?: (questionId: string, optionId: string) => Promise<void> | void;
  onDiscoveryPublish?: () => Promise<void> | void;
  onDiscoveryCancel?: () => Promise<void> | void;
  onDiscoveryRetry?: () => Promise<void> | void;
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
  onApproveApproval,
  onRejectApproval,
  onDownloadPdf,
  onSavePdfToFolder,
  onDismissError,
  onRegisterWorkflow,
  onAttachExample,
  onDiscoveryAnswer,
  onDiscoveryPublish,
  onDiscoveryCancel,
  onDiscoveryRetry,
}: AxWorkspaceChatProps) {
  const threadMessages = useMemo(() => toThreadMessages(messages), [messages]);
  // Interactivity follows the newest assistant message, not the newest message:
  // a failed send leaves the optimistic user message last, and the confirm
  // card before it must stay usable for retry.
  const lastAssistantIndex = messages.reduce(
    (latest, message, index) => (message.role === 'assistant' ? index : latest),
    -1,
  );
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
      <div className={'ax-workspace-chat' + (messages.length === 0 && !busy ? ' ax-workspace-chat--empty' : '')}>
        <ThreadPrimitive.Root className="ax-workspace-thread">
          {messages.length === 0 && !busy && !discoveryView && (
            <WorkspaceEmptyStage
              discoveryBusy={discoveryBusy}
              onAttachExample={onAttachExample}
              onSend={onSend}
            />
          )}
          <ThreadPrimitive.Viewport autoScroll className="ax-workspace-viewport">
            {messages.map((message, index) => message.role === 'user' ? (
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
              />
            ))}
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
              {workflowRegistered ? '업무로 등록됨' : '업무로 등록'}
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
