import { useCallback, useEffect, useState } from 'react';
import type { Node } from '@xyflow/react';
import type { useWorkspaceChat } from '../../hooks/useWorkspaceChat';
import { useDiscovery } from '../../hooks/useDiscovery';
import { WorkflowPreviewPanel } from '../../workflow/WorkflowPreviewPanel';
import { WorkConversationSplit } from '../work/WorkConversationSplit';
import { useWorkflowPanelWidth } from '../../hooks/useWorkflowPanelWidth';
import type { WorkflowVisualNodeData } from '../../workflow/types';
import { AxWorkspaceChat } from '../workspace/AxWorkspaceChat';
import { WorkspaceContextPanel } from '../workspace/WorkspaceContextPanel';
import '../workspace/ax-workspace.css';

type WorkspaceChatApi = ReturnType<typeof useWorkspaceChat>;

interface ChatMainPageProps {
  workspaceChat: WorkspaceChatApi;
}

export function ChatMainPage({ workspaceChat }: ChatMainPageProps) {
  const discovery = useDiscovery({
    onPublished: async () => {
      await workspaceChat.reset();
    },
  });
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
        busy={workspaceChat.busy || workspaceChat.sourceBusy || discovery.busy}
        error={workspaceChat.error || discovery.error}
        progress={discovery.view?.progress || workspaceChat.progress}
        workflowId={workspaceChat.workspaceWorkflowState?.workflowId}
        workflowRegistered={workspaceChat.workflowRegistered}
        discoveryView={discovery.view ?? undefined}
        discoveryBusy={discovery.busy}
        onSend={workspaceChat.sendMessage}
        onRegisterWorkflow={workspaceChat.registerWorkflow}
        onAttachExample={() => discovery.importAndStart('지난 결과물과 같은 방식으로 반복해 주세요')}
        onDiscoveryAnswer={discovery.answer}
        onDiscoveryPublish={() => void discovery.publish()}
      />
    </div>
  );

  return (
    <div className="chat-main-page">
      {workflowState && (
        <header className="chat-main-header">
          <div className="chat-main-title-wrap">
            <h1 className="chat-main-title">{title}</h1>
            <span className="draft-badge draft-badge-done">workflow</span>
          </div>
        </header>
      )}

      <WorkConversationSplit
        width={workflowPanelWidth}
        isResizing={isResizing}
        onSplitterPointerDown={onSplitterPointerDown}
        onSplitterDoubleClick={resetWidth}
        chat={chatBlock}
        panel={
          <WorkspaceContextPanel
            sources={workspaceChat.workspaceSources}
            sourceBusy={workspaceChat.sourceBusy}
            onAttachSource={workspaceChat.attachWorkspaceSource}
            workflow={showGraph ? (
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
              />
            ) : undefined}
          />
        }
      />
    </div>
  );
}
