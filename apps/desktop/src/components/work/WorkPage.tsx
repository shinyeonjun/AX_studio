import { useEffect, useState } from 'react';
import type { Node } from '@xyflow/react';
import type { AppState, WorkSummary } from '../../types/app-state';
import type { WorkFilter } from '../../types/navigation';
import type { useInterview } from '../../hooks/useInterview';
import { connectorEmoji, connectorLabel } from '../../constants/connectors';
import { formatRelativeTime, triggerLabel } from '../../lib/work-display';
import { IconPlay, IconPause } from '../icons';
import { PageHeader } from '../layout/PageHeader';
import { IconSearch } from '../icons';
import { ChatPanel } from './ChatPanel';
import { WorkflowPreviewPanel } from '../../workflow/WorkflowPreviewPanel';
import type { WorkflowVisualNodeData } from '../../workflow/types';

type InterviewApi = ReturnType<typeof useInterview>;

interface TaskCardProps {
  work: WorkSummary;
  globalActive: boolean;
  onOpen: () => void;
  onRun: () => void;
  onToggle: () => void;
  onDelete: () => void;
}

function TaskCard({ work, globalActive, onOpen, onRun, onToggle, onDelete }: TaskCardProps) {
  const statusLabel = !globalActive ? '퇴근 중' : work.active ? '실행 중' : '중지됨';
  const statusClass = !globalActive ? 'off-duty' : work.active ? 'running' : 'paused';

  return (
    <div className={`task-card ${!work.active ? 'paused' : ''}`}>
      <button type="button" className="task-card-main" onClick={onOpen}>
        <div className="task-icon-wrap">{connectorEmoji(work.connectors?.[0] ?? 'gmail')}</div>
        <div className="task-body">
          <h3 className="task-title">{work.name}</h3>
          <p className="task-desc">{work.goal || '설명 없음'}</p>
          <div className="task-meta">
            <div className="connector-badges">
              {(work.connectors ?? []).map((c) => (
                <span key={c} className="connector-badge">
                  {connectorEmoji(c)} {connectorLabel(c)}
                </span>
              ))}
            </div>
            <span className="status-pill">
              <span className={`status-dot ${statusClass}`} />
              {statusLabel}
            </span>
            <span className="meta-time">
              {triggerLabel(work.trigger)} · 최근 {formatRelativeTime(work.lastRunAt)}
            </span>
          </div>
        </div>
      </button>
      <div className="task-actions">
        <button
          type="button"
          className="btn btn-sm btn-ghost"
          onClick={(e) => {
            e.stopPropagation();
            onRun();
          }}
          title="지금 실행"
        >
          실행
        </button>
        <button
          type="button"
          className="btn btn-sm btn-ghost btn-danger-text"
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          title="업무 삭제"
        >
          삭제
        </button>
        <button
          type="button"
          className={`play-toggle ${work.active ? 'active' : ''}`}
          onClick={(e) => {
            e.stopPropagation();
            onToggle();
          }}
          title={work.active ? '업무 중지' : '업무 활성화'}
          aria-label={work.active ? '중지' : '활성화'}
        >
          {work.active ? <IconPause /> : <IconPlay />}
        </button>
      </div>
    </div>
  );
}

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
}: WorkPageProps) {
  const [selectedNode, setSelectedNode] = useState<Node<WorkflowVisualNodeData> | null>(null);

  useEffect(() => {
    setSelectedNode(null);
  }, [interview.workflow, interview.interview?.done]);

  if (view === 'conversation') {
    const title = interview.interview?.title ?? (interview.interview?.workflowId ? '업무' : '새 업무');
    const isDraft = !interview.interview?.workflowId;
    const finished = Boolean(interview.interview?.done);

    return (
      <div className={`work-conversation-page ${finished ? 'work-conversation-page--review' : ''}`}>
        <header className="work-conversation-header">
          <button type="button" className="btn btn-ghost settings-back" onClick={onBackToList}>
            ← 업무 목록
          </button>
          <div className="work-conversation-title-wrap">
            <h1 className="work-conversation-title">{title}</h1>
            {isDraft && !finished && <span className="draft-badge">설계 중</span>}
            {finished && <span className="draft-badge draft-badge-done">검토</span>}
          </div>
        </header>

        <div className="work-conversation-body">
          <div className="work-conversation-chat">
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
              onComposerChange={interview.setComposerText}
              onClearEditHint={() => interview.setEditHint(null)}
              onStartInterview={interview.startInterview}
              onSendAnswer={interview.sendAnswer}
              onRunOnce={interview.runOnce}
              onSaveAsWork={interview.saveAsWork}
            />
          </div>

          <WorkflowPreviewPanel
            draft={interview.workflow}
            baselineDraft={interview.workflowDiffBaseline}
            completeness={interview.completeness}
            done={finished}
            title={title}
            selectedNode={selectedNode}
            onSelectNode={setSelectedNode}
            onRequestEdit={interview.beginEditStep}
            onCloseDetail={() => setSelectedNode(null)}
          />
        </div>

        {finished && !interview.isLinkedWork && (
          <footer className="work-review-footer">
            <p className="work-review-footer-copy">이 구성으로 업무를 맡길까요?</p>
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

  return (
    <>
      <PageHeader
        title="업무"
        subtitle="맡긴 업무를 관리하고 대화로 수정할 수 있습니다"
        action={
          <button type="button" className="btn btn-primary" onClick={onNewTask}>
            + 새 업무
          </button>
        }
      />
      <div className="page-content">
        {works.length > 0 && (
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
              <option value="recurring">반복 업무</option>
              <option value="once">1회성</option>
              <option value="running">실행 중</option>
              <option value="paused">중지됨</option>
            </select>
          </div>
        )}

        {works.length === 0 ? (
          <div className="empty-state work-empty-state">
            <p>아직 맡긴 업무가 없습니다</p>
            <p className="muted">새 업무 대화를 시작해 AX에게 맡겨보세요.</p>
            <button type="button" className="btn btn-primary" onClick={onNewTask}>
              새 업무 대화 시작
            </button>
          </div>
        ) : (
          <div className="task-list">
            {works.map((work) => (
              <TaskCard
                key={work.id}
                work={work}
                globalActive={state?.globalActive ?? true}
                onOpen={() => onOpenWork(work.id)}
                onRun={() => onRunWorkflow(work.id)}
                onToggle={() => onToggleWork(work)}
                onDelete={() => onDeleteWork(work.id)}
              />
            ))}
          </div>
        )}
      </div>
    </>
  );
}
