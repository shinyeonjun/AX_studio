import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import type { Node } from '@xyflow/react';
import type { WorkspaceChatMessage } from '@ax-studio/core';
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

import { extractDraftFromMessages } from './workspace/tool-result/extract-draft';
import type { MessageToolDraft } from '@ax-studio/core';

type WorkspaceChatApi = ReturnType<typeof useWorkspaceChat>;

interface ChatMainPageProps {
  workspaceChat: WorkspaceChatApi;
}

function makeCandidateDraftMessage(
  tool: 'gmail' | 'slack',
  draft: MessageToolDraft,
  workspaceSessionId?: string
): WorkspaceChatMessage {
  return {
    role: 'assistant',
    content: tool === 'gmail' ? '작성된 메일 초안입니다.' : 'Slack 메시지 초안입니다.',
    approval: {
      id: `candidate-${tool}`,
      title: tool === 'gmail'
        ? (draft.subject ? `Gmail · ${draft.subject}` : 'Gmail · 메일 초안')
        : (draft.channel ? `Slack · ${draft.channel}` : 'Slack · 메시지 초안'),
      reason: '외부 전송 전 검토',
      toolResult: {
        approvalId: `candidate-${tool}`,
        executionId: `candidate-exec-${tool}`,
        workspaceSessionId: workspaceSessionId ?? 'default',
        actionId: tool === 'gmail' ? 'gmail.message.send' : 'slack.message.send',
        paramsHash: '0'.repeat(64),
        tool,
      },
    },
  };
}

export function ChatMainPage({ workspaceChat }: ChatMainPageProps) {
  const discovery = useDiscovery({
    workspaceContextKey: workspaceChat.workspaceContextKey,
    onPublished: async () => {
      await workspaceChat.reset();
    },
  });
  const [selectedNode, setSelectedNode] = useState<Node<WorkflowVisualNodeData> | null>(null);
  const [showContext, setShowContext] = useState(false);
  const [selectedResult, setSelectedResult] = useState<string>();
  const [sampleToolPreview, setSampleToolPreview] = useState<'gmail' | 'slack' | null>(null);

  const results = toolResultMessages(workspaceChat.displayMessages);
  const latestAssistant = workspaceChat.displayMessages.filter((m) => m.role === 'assistant').at(-1);
  const latestUser = workspaceChat.displayMessages.filter((m) => m.role === 'user').at(-1);

  const hasMessagingApproval = results.some(
    (r) => (r.approval?.toolResult?.tool === 'gmail' || r.approval?.toolResult?.tool === 'slack') && !r.toolSendOutcome
  );

  const detectedMessagingTool = !hasMessagingApproval && (sampleToolPreview || (() => {
    if (latestAssistant) {
      if (
        latestAssistant.inputRequests?.some((r) => r.id.includes('slack') || r.label.includes('Slack') || r.type?.includes('slack')) ||
        latestAssistant.presentations?.some((p) => p.inputs.some((r) => r.id.includes('slack') || r.label.includes('Slack') || r.type?.includes('slack'))) ||
        /slack|슬랙/i.test(latestAssistant.content)
      ) {
        return 'slack';
      }
      if (
        latestAssistant.inputRequests?.some((r) => r.id.includes('gmail') || r.label.includes('Gmail') || r.type?.includes('gmail')) ||
        latestAssistant.presentations?.some((p) => p.inputs.some((r) => r.id.includes('gmail') || r.label.includes('Gmail') || r.type?.includes('gmail'))) ||
        /gmail|지메일|메일|이메일|답장/i.test(latestAssistant.content)
      ) {
        return 'gmail';
      }
    }
    if (latestUser) {
      if (/slack|슬랙/i.test(latestUser.content)) {
        return 'slack';
      }
      if (/gmail|지메일|메일|이메일/i.test(latestUser.content)) {
        return 'gmail';
      }
    }
    return null;
  })());

  const activeTool = sampleToolPreview ?? detectedMessagingTool;

  const extractedRealDraft = useMemo(() => {
    if (!activeTool) return undefined;
    return extractDraftFromMessages(activeTool, workspaceChat.displayMessages, workspaceChat.workspaceSources);
  }, [activeTool, workspaceChat.displayMessages, workspaceChat.workspaceSources]);

  const candidateMessage = useMemo(() => {
    if (!activeTool || !extractedRealDraft) return undefined;
    return makeCandidateDraftMessage(activeTool, extractedRealDraft.draft, workspaceChat.workspaceSessionId);
  }, [activeTool, extractedRealDraft, workspaceChat.workspaceSessionId]);

  const allResults = useMemo(() => {
    if (candidateMessage && !results.some(r => r.approval?.id === candidateMessage.approval?.id)) {
      return [...results, candidateMessage];
    }
    return results;
  }, [results, candidateMessage]);

  const resultKey = (message: typeof allResults[number], index: number) =>
    (message.approval?.id ?? message.readResult?.id ?? message.executionId ?? 'result') + ':' + index;
  const selectedIndex = selectedResult === undefined ? -1 : allResults.findIndex((message, index) => resultKey(message, index) === selectedResult);
  const toolResult = selectedIndex >= 0 ? allResults[selectedIndex] : allResults.at(-1);

  useEffect(() => { setSelectedResult(undefined); }, [workspaceChat.workspaceContextKey]);
  useEffect(() => { setShowContext(false); }, [workspaceChat.workspaceContextKey, toolResult?.approval?.id, toolResult?.readResult?.id]);
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
  const workflowPreview = showGraph ? (
    <Suspense fallback={<div className="muted">워크플로 그래프를 불러오는 중…</div>}>
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
        workflowRegistered={workspaceChat.workflowRegistered}
        discoveryView={discovery.view ?? undefined}
        discoveryBusy={discovery.busy}
        onSend={workspaceChat.sendMessage}
        onApproveApproval={workspaceChat.approveChatApproval}
        onRejectApproval={workspaceChat.rejectChatApproval}
        onDownloadPdf={workspaceChat.downloadGeneratedPdf}
        onSavePdfToFolder={workspaceChat.saveGeneratedPdfToFolder}
        onDismissError={() => {
          workspaceChat.dismissError();
          discovery.dismissError();
        }}
        onRegisterWorkflow={workspaceChat.registerWorkflow}
        onAttachExample={() => discovery.importAndStart('지난 결과물과 같은 방식으로 반복해 주세요')}
        onDiscoveryAnswer={discovery.answer}
        onDiscoveryPublish={() => void discovery.publish()}
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
        resultVisible={Boolean(toolResult)}
        chat={chatBlock}
        panel={
          <div className="tool-result-panel">
          {allResults.length > 1 && <nav className="tool-result-history" aria-label="이 대화의 결과">
            {allResults.map((message, index) => <button type="button" key={resultKey(message, index)}
              aria-pressed={message === toolResult} onClick={() => { setSelectedResult(resultKey(message, index)); setShowContext(false); }}>
              {message.approval?.toolResult?.tool === 'gmail' ? 'Gmail 초안' : message.approval?.toolResult?.tool === 'slack' ? 'Slack 초안'
                : message.toolSendOutcome ? (message.toolSendOutcome.binding.provider === 'gmail' ? 'Gmail 결과' : 'Slack 결과') : 'DB 조회'} {index + 1}
            </button>)}
          </nav>}
          {toolResult && <>
            <button type="button" className="tool-result-context-link" onClick={() => setShowContext(current => !current)}>{showContext ? '결과 편집으로 돌아가기' : '자료 · 흐름 보기'}</button>
            <div className="tool-result-view" hidden={showContext}>
            <ToolResultPane
              key={workspaceChat.workspaceContextKey + (toolResult.approval?.id ?? '')}
              message={toolResult}
              busy={workspaceChat.busy || discovery.busy}
              active={!showContext}
              initialDraft={extractedRealDraft?.draft}
              attachments={extractedRealDraft?.attachments}
              workspaceLabel={workspaceChat.workspaceWorkflowState?.title ?? 'AX Workspace'}
              onConfirm={async (confirmation, confirmedDraft) => {
                if (confirmation.approvalId.startsWith('candidate-') || confirmation.approvalId.startsWith('sample-')) {
                  const isGmail = activeTool === 'gmail';
                  const draft = confirmedDraft ?? extractedRealDraft?.draft;
                  const prompt = isGmail
                    ? `[메일 발송 실행] 받는 사람: ${draft?.to || ''}, 제목: "${draft?.subject || ''}" 내용: "${draft?.body || ''}" 발송 진행해줘.`
                    : `[Slack 게시 실행] 채널: ${draft?.channel || ''} 내용: "${draft?.text || ''}" 게시 진행해줘.`;
                  await workspaceChat.sendMessage(prompt);
                  return { executionId: 'candidate-exec', status: 'success', log: [] };
                }
                return workspaceChat.confirmToolResult(confirmation);
              }}
              onCancel={async (approvalId) => {
                if (approvalId.startsWith('candidate-') || approvalId.startsWith('sample-')) {
                  setSampleToolPreview(null);
                  return;
                }
                return workspaceChat.rejectChatApproval(approvalId);
              }}
              onToggleSample={() => setSampleToolPreview(cur => cur === 'slack' ? 'gmail' : 'slack')}
            />
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
