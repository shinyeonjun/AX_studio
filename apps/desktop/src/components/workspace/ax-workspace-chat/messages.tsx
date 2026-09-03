import type { WorkspaceChatMessage } from '@ax-studio/core';
import { axStudioLogo } from '../../../constants/brand';
import { isRunResultMessage, WorkspaceRunResultCard } from '../WorkspaceRunResultCard';
import { WorkspaceMarkdown } from '../WorkspaceMarkdown';
import { WorkspaceAssistantPresentation } from '../WorkspaceAssistantPresentation';

export function UserMessage({ message }: { message: WorkspaceChatMessage }) {
  return (
    <div className="ax-workspace-message ax-workspace-message--user">
      <div className="ax-workspace-bubble ax-workspace-bubble--user">{message.content}</div>
    </div>
  );
}

export interface AssistantMessageProps {
  message: WorkspaceChatMessage;
  busy: boolean;
  isLatest: boolean;
  onSend: (text: string) => Promise<void>;
  onApproveApproval?: (approvalId: string) => Promise<void>;
  onRejectApproval?: (approvalId: string) => Promise<void>;
}

export function AssistantMessage({
  message,
  busy,
  isLatest,
  onSend,
  onApproveApproval,
  onRejectApproval,
}: AssistantMessageProps) {
  const content = isRunResultMessage(message)
    ? (
      <WorkspaceRunResultCard
        content={message.content}
        status={message.executionStatus}
        approval={message.approval}
        busy={busy}
        onApprove={onApproveApproval}
        onReject={onRejectApproval}
      />
    )
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
          interactive={isLatest}
          onSend={onSend}
        />
      </div>
    </div>
  );
}
