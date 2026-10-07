import { lazy, Suspense, useCallback, useEffect, useState, type ReactNode } from 'react';
import type { Node } from '@xyflow/react';
import type { useWorkspaceChat } from '../hooks/useWorkspaceChat';
import { useDiscovery } from '../hooks/useDiscovery';
import { WorkConversationSplit } from './workspace/WorkConversationSplit';
import { useWorkflowPanelWidth } from '../hooks/useWorkflowPanelWidth';
import type { WorkflowVisualNodeData } from '../../workflows/authoring/types';
import { AxWorkspaceChat } from './workspace/AxWorkspaceChat';
import { WorkspaceContextPanel } from './workspace/WorkspaceContextPanel';
import { WorkspaceFlowPanel } from './workspace/WorkspaceFlowPanel';
import './workspace/ax-workspace.css';
import { toolResultMessages, ToolResultPane } from './workspace/tool-result/ToolResultPane';

const WorkflowPreviewPanel = lazy(() =>
  import('../../workflows/authoring/WorkflowPreviewPanel').then(({ WorkflowPreviewPanel }) => ({
    default: WorkflowPreviewPanel,
  })),
);

type WorkspaceChatApi = ReturnType<typeof useWorkspaceChat>;

interface ChatMainPageProps {
  workspaceChat: WorkspaceChatApi;
  /** Host-level setup notice (e.g. Jev not connected) shown above the conversation. */
  setupNotice?: ReactNode;
}

export function ChatMainPage({ workspaceChat, setupNotice }: ChatMainPageProps) {
  const discovery = useDiscovery({
    workspaceContextKey: workspaceChat.workspaceContextKey,
    // Show the saved work (its run button and results), not an empty chat.
    onPublished: async (workflowId) => {
      await workspaceChat.openWorkChat(workflowId);
    },
  });
  const savedTriggerType = workspaceChat.workspaceWorkflowState?.draft?.trigger?.type;
  const isManualWork = Boolean(workspaceChat.workspaceWorkflowState?.workflowId)
    && (!savedTriggerType || savedTriggerType === 'manual');
  const [selectedNode, setSelectedNode] = useState<Node<WorkflowVisualNodeData> | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [selectedResult, setSelectedResult] = useState<string>();
  const results = toolResultMessages(workspaceChat.displayMessages);
  const resultKey = (message: typeof results[number], index: number) => (message.approval?.id ?? message.readResult?.id ?? message.executionId ?? 'result') + ':' + index;
  const selectedIndex = selectedResult === undefined ? -1 : results.findIndex((message, index) => resultKey(message, index) === selectedResult);
  const toolResult = selectedIndex >= 0 ? results[selectedIndex] : results.at(-1);
  useEffect(() => { setSelectedResult(undefined); }, [workspaceChat.workspaceContextKey]);
  useEffect(() => { setShowContext(false); }, [workspaceChat.workspaceContextKey, toolResult?.approval?.id, toolResult?.readResult?.id]);
  const { width: workflowPanelWidth, isResizing, onSplitterPointerDown, onSplitterKeyDown, resetWidth } =
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
  const workflowPreview = showGraph ? (
    <Suspense fallback={<div className="muted">업무 흐름을 불러오는 중…</div>}>
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
    </Suspense>
  ) : undefined;
  const flowPanel = (
    <WorkspaceFlowPanel
      messages={workspaceChat.displayMessages}
      busy={workspaceChat.busy}
      discoveryBusy={discovery.busy}
      progress={discovery.view?.progress || workspaceChat.progress}
      error={workspaceChat.error || discovery.error}
      discovery={discovery.view ?? undefined}
      workflow={workflowState}
    />
  );

  const chatBlock = (
    <div className="work-conversation-chat">
      {setupNotice}
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
        busy={workspaceChat.busy || discovery.busy}
        error={workspaceChat.error || discovery.error}
        progress={discovery.view?.progress || workspaceChat.progress}
        workflowId={workspaceChat.workspaceWorkflowState?.workflowId}
        resumableDiscoveries={discovery.resumable}
        onResumeDiscovery={discovery.resume}
        workflowRegistered={workspaceChat.workflowRegistered}
        discoveryView={discovery.view ?? undefined}
        discoveryBusy={discovery.busy}
        onSend={workspaceChat.sendMessage}
        onApproveApproval={workspaceChat.approveChatApproval}
        onRejectApproval={workspaceChat.rejectChatApproval}
        onDownloadPdf={workspaceChat.downloadGeneratedPdf}
        onSavePdfToFolder={workspaceChat.saveGeneratedPdfToFolder}
        // A conversation tied to a saved job already repeats; offer this only for one-off runs.
        onMakeRecurring={workspaceChat.workspaceWorkflowState ? undefined : workspaceChat.makeRecurring}
        onDismissError={() => {
          workspaceChat.dismissError();
          discovery.dismissError();
        }}
        // A manual work runs when asked: offer running it; a scheduled or event work is switched on.
        {...(isManualWork
          ? { onRunWorkflow: () => window.ax.runWorkflow(workspaceChat.workspaceWorkflowState!.workflowId!).then(() => undefined) }
          : { onRegisterWorkflow: workspaceChat.registerWorkflow })}
        onAttachExample={() => discovery.importAndStart('지난 결과물과 같은 방식으로 반복해 주세요')}
        onDiscoveryAnswer={discovery.answer}
        onDiscoveryPublish={(schedule) => void discovery.publish(undefined, schedule)}
        onDiscoveryCancel={discovery.cancel}
        onDiscoveryRetry={discovery.retry}
      />
    </div>
  );

  return (
    <div className="chat-main-page">
      {workflowState && (
        <header className="chat-main-header">
          <div className="chat-main-title-wrap">
            <h1 className="chat-main-title">{title}</h1>
            <span className="draft-badge draft-badge-done">업무</span>
          </div>
        </header>
      )}

      <WorkConversationSplit
        width={workflowPanelWidth}
        isResizing={isResizing}
        onSplitterPointerDown={onSplitterPointerDown}
        onSplitterDoubleClick={resetWidth}
        onSplitterKeyDown={onSplitterKeyDown}
        resultVisible={Boolean(toolResult)}
        chat={chatBlock}
        panel={
          <div className="tool-result-panel">
          {results.length > 1 && <nav className="tool-result-history" aria-label="이 대화의 결과">
            {results.map((message, index) => <button type="button" key={resultKey(message, index)}
              aria-pressed={message === toolResult} onClick={() => { setSelectedResult(resultKey(message, index)); setShowContext(false); }}>
              {message.approval?.toolResult?.tool === 'gmail' ? 'Gmail 초안' : message.approval?.toolResult?.tool === 'slack' ? 'Slack 초안'
                : message.toolSendOutcome ? (message.toolSendOutcome.binding.provider === 'gmail' ? 'Gmail 결과' : 'Slack 결과') : 'DB 조회'} {index + 1}
            </button>)}
          </nav>}
          {toolResult && <>
            <button type="button" className="tool-result-context-link" onClick={() => setShowContext(current => !current)}>{showContext ? '결과 편집으로 돌아가기' : '자료 · 흐름 보기'}</button>
            <div className="tool-result-view" hidden={showContext}>
            <ToolResultPane key={workspaceChat.workspaceContextKey} message={toolResult} busy={workspaceChat.busy || discovery.busy} active={!showContext}
              onConfirm={workspaceChat.confirmToolResult} onCancel={workspaceChat.rejectChatApproval} />
            </div>
          </>}
          <div className="tool-result-context" hidden={Boolean(toolResult && !showContext)}>
          <WorkspaceContextPanel
            sources={workspaceChat.workspaceSources}
            sourceBusy={workspaceChat.sourceBusy}
            onAttachSource={workspaceChat.attachWorkspaceSource}
            flow={flowPanel}
            workflow={workflowPreview}
            workflowAvailable={showGraph}
          />
          </div>
          </div>
        }
      />
    </div>
  );
}
