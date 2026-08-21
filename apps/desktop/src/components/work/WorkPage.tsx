import { useCallback, useEffect, useState } from 'react';
import type { Node } from '@xyflow/react';
import type { AppState, WorkSummary } from '../../types/app-state';
import type { WorkFilter, SettingsScreen } from '../../types/navigation';
import type { useInterview } from '../../hooks/useInterview';
import { PageHeader } from '../layout/PageHeader';
import { IconSearch } from '../icons';
import { WorkScopeSwitch } from './WorkScopeSwitch';
import { ChatPanel } from './ChatPanel';
import { WorkList } from './WorkList';
import { WorkflowPreviewPanel } from '../../workflow/WorkflowPreviewPanel';
import { WorkConversationSplit } from './WorkConversationSplit';
import { useWorkflowPanelWidth } from '../../hooks/useWorkflowPanelWidth';
import type { WorkflowVisualNodeData } from '../../workflow/types';

type InterviewApi = ReturnType<typeof useInterview>;

interface WorkPageProps {
  state: AppState | null;
  works: WorkSummary[];
  workFilter: WorkFilter;
  search: string;
  view: 'list' | 'conversation';
  interview: InterviewApi;
  onWorkFilterChange: (filter: WorkFilter) => void;
  onSearchChange: (value: string) => void;
  onNewTask: () => void;
  onOpenWork: (workflowId: string) => void;
  onBackToList: () => void;
  onRunWorkflow: (workflowId: string) => void;
  onToggleWork: (work: WorkSummary) => void;
  onDeleteWork: (workflowId: string) => void;
  onOpenSettings?: (screen: SettingsScreen) => void;
}

export function WorkPage({
  state,
  works,
  workFilter,
  search,
  view,
  interview,
  onWorkFilterChange,
  onSearchChange,
  onNewTask,
  onOpenWork,
  onBackToList,
  onRunWorkflow,
  onToggleWork,
  onDeleteWork,
  onOpenSettings,
}: WorkPageProps) {
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

  if (view === 'conversation') {
    const title = interview.interview?.title ?? (interview.interview?.workflowId ? '업무' : '새 업무');
    const isDraft = !interview.interview?.workflowId;
    const finished = Boolean(interview.interview?.done);
    const readyToCommit = finished && Boolean(interview.completeness?.deployable);

    return (
      <div className={`work-conversation-page ${readyToCommit ? 'work-conversation-page--review' : ''}`}>
        <header className="work-conversation-header">
          <button type="button" className="btn btn-ghost settings-back" onClick={onBackToList}>
            ← 업무 목록
          </button>
          <div className="work-conversation-title-wrap">
            <h1 className="work-conversation-title">{title}</h1>
            {isDraft && !readyToCommit && <span className="draft-badge">설계 중</span>}
            {readyToCommit && <span className="draft-badge draft-badge-done">검토</span>}
          </div>
        </header>

        <WorkConversationSplit
          width={workflowPanelWidth}
          isResizing={isResizing}
          onSplitterPointerDown={onSplitterPointerDown}
          onSplitterDoubleClick={resetWidth}
          chat={
            <ChatPanel
              interview={interview.interview}
              busy={interview.busy}
              error={interview.error}
              progress={interview.progress}
              composerText={interview.composerText}
              editHint={interview.editHint}
              isLinkedWork={interview.isLinkedWork}
              isImmediateOnce={interview.isImmediateOnce}
              isDeferredOnce={interview.isDeferredOnce}
              isRecurringDraft={interview.isRecurringDraft}
              reviewReady={readyToCommit}
              onComposerChange={interview.setComposerText}
              onClearEditHint={() => interview.setEditHint(null)}
              onStartInterview={interview.startInterview}
              workScope={interview.workScope}
              workScopeLocked={interview.workScopeLocked}
              onWorkScopeChange={interview.setWorkScope}
              onSendAnswer={interview.sendAnswer}
              onRunOnce={interview.runOnce}
              onSaveAsWork={interview.saveAsWork}
            />
          }
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
              onOpenSettings={onOpenSettings}
              onCloseDetail={() => handleSelectNode(null)}
              workScope={interview.workScope}
            />
          }
        />

        {readyToCommit && !interview.isLinkedWork && (
          <footer className="work-review-footer">
            <p className="work-review-footer-copy">설계가 완료됐습니다. 이 구성으로 업무를 맡길까요?</p>
            <div className="work-review-footer-actions">
              {interview.isDeferredOnce ? (
                <>
                  <button type="button" className="btn btn-primary" onClick={interview.saveAsWork} disabled={interview.busy}>
                    예약 업무로 저장
                  </button>
                  <button type="button" className="btn" onClick={interview.runOnce} disabled={interview.busy}>
                    지금 바로 실행
                  </button>
                </>
              ) : interview.isImmediateOnce ? (
                <>
                  <button type="button" className="btn btn-primary" onClick={interview.runOnce} disabled={interview.busy}>
                    한 번만 실행
                  </button>
                  <button type="button" className="btn" onClick={interview.saveAsWork} disabled={interview.busy}>
                    업무로 저장
                  </button>
                </>
              ) : (
                <>
                  <button type="button" className="btn" onClick={interview.runOnce} disabled={interview.busy}>
                    테스트 실행
                  </button>
                  <button type="button" className="btn btn-primary" onClick={interview.saveAsWork} disabled={interview.busy}>
                    {interview.isRecurringDraft ? '이대로 맡기기' : '업무로 저장'}
                  </button>
                </>
              )}
            </div>
          </footer>
        )}
      </div>
    );
  }

  const allWorks = state?.works ?? [];

  return (
    <>
      <PageHeader
        title="업무"
        subtitle="맡긴 업무를 관리하고 대화로 수정할 수 있습니다"
        action={
          <div className="work-new-task-actions">
            <WorkScopeSwitch
              value={interview.workScope}
              disabled={interview.workScopeLocked}
              onChange={interview.setWorkScope}
            />
            <button type="button" className="btn btn-primary" onClick={onNewTask}>
              + 새 업무
            </button>
          </div>
        }
      />
      <div className="page-content">
        <div className="toolbar">
          <div className="search-box">
            <IconSearch />
            <input placeholder="업무 검색..." value={search} onChange={(e) => onSearchChange(e.target.value)} />
          </div>
          <select
            className="filter-select"
            value={workFilter}
            onChange={(e) => onWorkFilterChange(e.target.value as WorkFilter)}
          >
            <option value="all">전체</option>
            <option value="recurring">업무</option>
            <option value="once">일회용</option>
            <option value="running">실행 중</option>
            <option value="paused">중지됨</option>
          </select>
        </div>

        {allWorks.length === 0 ? (
          <div className="empty-state work-empty-state">
            <p>아직 맡긴 업무가 없습니다</p>
            <p className="muted">새 업무 대화를 시작해 AX에게 맡겨보세요.</p>
            <button type="button" className="btn btn-primary" onClick={onNewTask}>
              새 업무 대화 시작
            </button>
          </div>
        ) : works.length === 0 ? (
          <div className="empty-state work-empty-state">
            <p>조건에 맞는 업무가 없습니다</p>
            <p className="muted">검색어나 필터를 바꿔 보세요.</p>
          </div>
        ) : (
          <WorkList
            works={works}
            workFilter={workFilter}
            globalActive={state?.globalActive ?? true}
            onOpenWork={onOpenWork}
            onRunWorkflow={onRunWorkflow}
            onToggleWork={onToggleWork}
            onDeleteWork={onDeleteWork}
          />
        )}
      </div>
    </>
  );
}
