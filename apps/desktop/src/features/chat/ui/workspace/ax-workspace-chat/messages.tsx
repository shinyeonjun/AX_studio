import type { WorkspaceChatMessage } from '@ax-studio/core';
import { lazy, memo, Suspense } from 'react';
import { withoutScheduleTokens } from '@ax-studio/core/schedule';
import type { GeneratedArtifactExportResult } from '../../../../../types/ax-api/contracts';
import { axStudioLogo } from '../../../../../ui/constants/brand';
import { isRunResultMessage, WorkspaceRunResultCard } from '../WorkspaceRunResultCard';
import { WorkspaceAssistantPresentation } from '../WorkspaceAssistantPresentation';
import { MakeRecurringOffer } from '../MakeRecurringOffer';
import { RunResultTable } from '../RunResultTable';

const WorkspaceMarkdown = lazy(() =>
  import('../WorkspaceMarkdown').then(({ WorkspaceMarkdown }) => ({ default: WorkspaceMarkdown })),
);

export const UserMessage = memo(function UserMessage({ message }: { message: WorkspaceChatMessage }) {
  return (
    <div className="ax-workspace-message ax-workspace-message--user">
      <div className="ax-workspace-bubble ax-workspace-bubble--user">{withoutScheduleTokens(message.content)}</div>
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
  /** Offered only in a conversation not already tied to a saved job. */
  onMakeRecurring?: (source: { executionId: string } | { latestRead: true }, scheduleValue: string) => Promise<void>;
  /** This is the newest read answer, the only one whose recipe the host still holds. */
  isLatestRead?: boolean;
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
  onMakeRecurring,
  isLatestRead = false,
}: AssistantMessageProps) {
  const executionId = message.executionId;
  // A finished one-off run repeats the steps that ran; a read answer repeats the read and shaping
  // that produced its table. Either way nothing is re-planned.
  const repeatsRun = Boolean(onMakeRecurring && executionId && isRunResultMessage(message)
    && message.executionStatus === 'success');
  const repeatsRead = Boolean(onMakeRecurring && !repeatsRun && message.readResult && message.readRepeatable && isLatestRead);
  const makeRecurring = repeatsRun
    ? (scheduleValue: string) => onMakeRecurring!({ executionId: executionId! }, scheduleValue)
    : repeatsRead
      ? (scheduleValue: string) => onMakeRecurring!({ latestRead: true }, scheduleValue)
      : undefined;
  const content = isRunResultMessage(message)
    ? (
      <WorkspaceRunResultCard
        content={message.content}
        status={message.executionStatus}
        approval={message.approval}
        generatedPdf={message.generatedPdf}
        generatedSpreadsheet={message.generatedSpreadsheet}
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
        {isRunResultMessage(message) && message.readResult && <RunResultTable table={message.readResult} />}
        {makeRecurring && <MakeRecurringOffer busy={busy} onSubmit={makeRecurring} />}
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
