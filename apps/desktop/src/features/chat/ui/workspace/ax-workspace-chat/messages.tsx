import type { WorkspaceChatMessage } from '@ax-studio/core';
import { lazy, memo, Suspense } from 'react';
import type { GeneratedArtifactExportResult } from '../../../../../types/ax-api/contracts';
import { axStudioLogo } from '../../../../../ui/constants/brand';
import { isRunResultMessage, WorkspaceRunResultCard } from '../WorkspaceRunResultCard';
import { WorkspaceAssistantPresentation } from '../WorkspaceAssistantPresentation';

const WorkspaceMarkdown = lazy(() =>
  import('../WorkspaceMarkdown').then(({ WorkspaceMarkdown }) => ({ default: WorkspaceMarkdown })),
);

export const UserMessage = memo(function UserMessage({ message }: { message: WorkspaceChatMessage }) {
  return (
    <div className="ax-workspace-message ax-workspace-message--user">
      <div className="ax-workspace-bubble ax-workspace-bubble--user">{message.content}</div>
    </div>
  );
});

export interface AssistantMessageProps {
  message: WorkspaceChatMessage;
  busy: boolean;
  isLatest: boolean;
  onSend: (text: string) => Promise<void>;
  onApproveApproval?: (approvalId: string) => Promise<void>;
  onRejectApproval?: (approvalId: string) => Promise<void>;
  onDownloadPdf?: (artifactId: string) => Promise<GeneratedArtifactExportResult>;
  onSavePdfToFolder?: (artifactId: string) => Promise<GeneratedArtifactExportResult>;
}

export const AssistantMessage = memo(function AssistantMessage({
  message,
  busy,
  isLatest,
  onSend,
  onApproveApproval,
  onRejectApproval,
  onDownloadPdf,
  onSavePdfToFolder,
}: AssistantMessageProps) {
  const content = isRunResultMessage(message)
    ? (
      <WorkspaceRunResultCard
        content={message.content}
        status={message.executionStatus}
        approval={message.approval}
        generatedPdf={message.generatedPdf}
        busy={busy}
        onApprove={onApproveApproval}
        onReject={onRejectApproval}
        onDownloadPdf={onDownloadPdf}
        onSavePdfToFolder={onSavePdfToFolder}
      />
    )
    : (
      <Suspense fallback={<div className="muted" role="status">응답을 표시하는 중…</div>}>
        <WorkspaceMarkdown content={message.content} />
      </Suspense>
    );

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
});
