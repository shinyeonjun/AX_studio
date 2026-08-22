import { useCallback, useEffect, useState } from 'react';
import type { Node } from '@xyflow/react';
import type { SettingsScreen } from '../../types/navigation';
import type { useInterview } from '../../hooks/useInterview';
import { WorkflowPreviewPanel } from '../../workflow/WorkflowPreviewPanel';
import { WorkConversationSplit } from '../work/WorkConversationSplit';
import { useWorkflowPanelWidth } from '../../hooks/useWorkflowPanelWidth';
import type { WorkflowVisualNodeData } from '../../workflow/types';
import { AxWorkspaceChat } from '../workspace/AxWorkspaceChat';
import '../workspace/ax-workspace.css';

type InterviewApi = ReturnType<typeof useInterview>;

interface ChatMainPageProps {
  interview: InterviewApi;
  settingsScreen: SettingsScreen | null;
  onCloseSettings: () => void;
  settingsContent?: React.ReactNode;
}

export function ChatMainPage({
  interview,
  settingsScreen,
  onCloseSettings,
  settingsContent,
}: ChatMainPageProps) {
  const [selectedNode, setSelectedNode] = useState<Node<WorkflowVisualNodeData> | null>(null);
  const { width: workflowPanelWidth, isResizing, onSplitterPointerDown, resetWidth } =
    useWorkflowPanelWidth();

  const handleSelectNode = useCallback((node: Node<WorkflowVisualNodeData> | null) => {
    setSelectedNode((prev) => {
      const prevId = prev?.id ?? null;
      const nextId = node?.id ?? null;
      if (prevId === nextId) return prev;
      return node;
    });
  }, []);

  useEffect(() => {
    if (interview.interview?.done) {
      setSelectedNode(null);
    }
  }, [interview.interview?.done]);

  if (settingsScreen && settingsContent) {
    return (
      <div className="chat-main-settings">
        <header className="chat-main-settings-header">
          <button type="button" className="btn btn-ghost" onClick={onCloseSettings}>
            ← 대화로 돌아가기
          </button>
        </header>
        <div className="chat-main-settings-body">{settingsContent}</div>
      </div>
    );
  }

  const title = interview.interview?.title ?? 'AX Workspace';
  const isDraft = Boolean(interview.interview && !interview.interview.workflowId);
  const finished = Boolean(interview.interview?.done);
  const readyToCommit = finished && Boolean(interview.completeness?.deployable);
  const showGraph = Boolean(interview.interview);

  const chatBlock = (
    <div className="work-conversation-chat">
      {interview.editHint && (
        <div className="chat-edit-hint">
          <span>{interview.editHint}</span>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => interview.setEditHint(null)}
          >
            취소
          </button>
        </div>
      )}
      <AxWorkspaceChat
        messages={interview.displayMessages}
        busy={interview.busy}
        error={interview.error}
        progress={interview.progress}
        reviewReady={readyToCommit}
        reviewActions={{
          busy: interview.busy,
          isLinkedWork: interview.isLinkedWork,
          isImmediateOnce: interview.isImmediateOnce,
          isDeferredOnce: interview.isDeferredOnce,
          isRecurringDraft: interview.isRecurringDraft,
          allowExternalAuto: interview.allowExternalAuto,
          approvalGateCount: interview.approvalGateCount,
          highRiskGateCount: interview.highRiskGateCount,
          onAllowExternalAutoChange: interview.setAllowExternalAuto,
          onRunOnce: interview.runOnce,
          onSaveAsWork: interview.saveAsWork,
        }}
        slashCommandsEnabled={!interview.interview}
        onSend={interview.sendMessage}
      />
    </div>
  );

  return (
    <div className={`chat-main-page ${readyToCommit ? 'chat-main-page--review' : ''} ${showGraph ? '' : 'chat-main-page--solo'}`}>
      {interview.interview && (
        <header className="chat-main-header">
          <div className="chat-main-title-wrap">
            <h1 className="chat-main-title">{title}</h1>
            {isDraft && !readyToCommit && <span className="draft-badge">설계 중</span>}
            {readyToCommit && <span className="draft-badge draft-badge-done">검토</span>}
          </div>
        </header>
      )}

      {showGraph ? (
        <WorkConversationSplit
          width={workflowPanelWidth}
          isResizing={isResizing}
          onSplitterPointerDown={onSplitterPointerDown}
          onSplitterDoubleClick={resetWidth}
          chat={chatBlock}
          panel={
            <WorkflowPreviewPanel
              draft={interview.workflow}
              baselineDraft={interview.workflowDiffBaseline}
              completeness={interview.completeness}
              done={readyToCommit}
              title={title}
              selectedNode={selectedNode}
              panelBusy={interview.busy}
              onSelectNode={handleSelectNode}
              onRequestEdit={interview.beginEditStep}
              onCloseDetail={() => handleSelectNode(null)}
              workScope={interview.workScope}
            />
          }
        />
      ) : (
        chatBlock
      )}
    </div>
  );
}
