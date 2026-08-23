import { useCallback, useEffect, useState } from 'react';
import type { Node } from '@xyflow/react';
import type { useWorkspaceChat } from '../../hooks/useWorkspaceChat';
import { WorkflowPreviewPanel } from '../../workflow/WorkflowPreviewPanel';
import { WorkConversationSplit } from '../work/WorkConversationSplit';
import { useWorkflowPanelWidth } from '../../hooks/useWorkflowPanelWidth';
import type { WorkflowVisualNodeData } from '../../workflow/types';
import { AxWorkspaceChat } from '../workspace/AxWorkspaceChat';
import '../workspace/ax-workspace.css';

type WorkspaceChatApi = ReturnType<typeof useWorkspaceChat>;

interface ChatMainPageProps {
  workspaceChat: WorkspaceChatApi;
}

export function ChatMainPage({ workspaceChat }: ChatMainPageProps) {
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
    if (workspaceChat.workspaceWorkflowState) {
      setSelectedNode(null);
    }
  }, [workspaceChat.workspaceWorkflowState]);

  const workflowState = workspaceChat.workspaceWorkflowState;
  const title = workflowState?.title ?? 'AX Workspace';
  const showGraph = Boolean(workflowState);

  const chatBlock = (
    <div className="work-conversation-chat">
      {workspaceChat.editHint && (
        <div className="chat-edit-hint">
          <span>{workspaceChat.editHint}</span>
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => workspaceChat.setEditHint(null)}
          >
            취소
          </button>
        </div>
      )}
      <AxWorkspaceChat
        messages={workspaceChat.displayMessages}
        busy={workspaceChat.busy}
        error={workspaceChat.error}
        progress={workspaceChat.progress}
        slashCommandsEnabled
        onSend={workspaceChat.sendMessage}
      />
    </div>
  );

  return (
    <div className={`chat-main-page ${showGraph ? '' : 'chat-main-page--solo'}`}>
      {workflowState && (
        <header className="chat-main-header">
          <div className="chat-main-title-wrap">
            <h1 className="chat-main-title">{title}</h1>
            <span className="draft-badge draft-badge-done">workflow</span>
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
              draft={workflowState?.workflow}
              baselineDraft={undefined}
              completeness={workflowState?.completeness}
              done
              title={title}
              selectedNode={selectedNode}
              panelBusy={workspaceChat.busy}
              onSelectNode={handleSelectNode}
              onRequestEdit={workspaceChat.beginEditStep}
              onCloseDetail={() => handleSelectNode(null)}
              executionMode={workflowState?.executionMode}
            />
          }
        />
      ) : (
        chatBlock
      )}
    </div>
  );
}
