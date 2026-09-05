import type { AppState } from '../../../types/app-state';
import type { ChatSessionSummary } from '../../../hooks/useChatSessions';
import {
  executionErrorLabel,
  executionStatusLabel,
  executionTriggerLabel,
  formatRelativeTime,
  isEphemeralWork,
  isPersistentWork,
  isSingleExecution,
  triggerLabel,
} from '../../../lib/work-display';
import { IconTrash } from '../../icons';

type ExecutionSummary = AppState['executions'][number];

interface SidebarWorkPanelProps {
  state: AppState | null;
  sessions: ChatSessionSummary[];
  onOpenWork: (workflowId: string) => void;
  onOpenExecution: (execution: ExecutionSummary) => void;
  onToggleWorkActive: (workflowId: string, active: boolean) => void;
  onDeleteWork: (workflowId: string, name: string) => void;
}

function executionTitle(execution: ExecutionSummary, sessions: ChatSessionSummary[]): string {
  const sessionTitle = sessions.find((session) => session.id === execution.workspaceSessionId)?.title;
  if (sessionTitle?.trim()) return sessionTitle;
  if (execution.generatedPdf?.fileName) return execution.generatedPdf.fileName;
  return '일회 실행';
}

function executionPresentation(execution: ExecutionSummary): {
  tone: 'success' | 'running' | 'pending' | 'failed' | 'neutral';
  label: string;
} {
  if (execution.resultStatus === 'failed' || execution.status === 'failed') {
    return { tone: 'failed', label: execution.resultStatus === 'failed' ? '결과 검토 필요' : '실패' };
  }
  if (execution.status === 'pending_approval') return { tone: 'pending', label: '승인 대기' };
  if (execution.status === 'running') return { tone: 'running', label: '실행 중' };
  if (execution.status === 'success') return { tone: 'success', label: '완료' };
  return { tone: 'neutral', label: executionStatusLabel(execution.status) };
}

function executionDetail(execution: ExecutionSummary): string {
  if (execution.currentStepMessage) return execution.currentStepMessage;
  const error = executionErrorLabel(execution.errorCode);
  if (error) return error;
  return executionTriggerLabel(execution.triggerType);
}

export function SidebarWorkPanel({
  state,
  sessions,
  onOpenWork,
  onOpenExecution,
  onToggleWorkActive,
  onDeleteWork,
}: SidebarWorkPanelProps) {
  const works = state?.works ?? [];
  const recurringWorks = works.filter((work) => isPersistentWork(work.trigger));
  const oneOffWorks = works.filter((work) => isEphemeralWork(work.trigger));
  const singleExecutions = (state?.executions ?? [])
    .filter(isSingleExecution)
    .slice(0, 6);
  const oneOffCount = oneOffWorks.length + singleExecutions.length;

  return (
    <div className="sidebar-panel-section sidebar-work-overview">
      <section className="sidebar-work-group" aria-labelledby="sidebar-recurring-work-title">
        <div className="sidebar-work-group-header">
          <div>
            <h2 id="sidebar-recurring-work-title" className="sidebar-section-title">
              반복 업무
            </h2>
            <p className="sidebar-work-group-subtitle">활성화하면 일정에 맞춰 자동 실행됩니다</p>
          </div>
          <span className="sidebar-work-count" aria-label={`반복 업무 ${recurringWorks.length}개`}>
            {recurringWorks.length}
          </span>
        </div>

        {recurringWorks.length === 0 ? (
          <div className="sidebar-work-empty">
            <p>반복 업무가 없습니다</p>
            <span>업무를 저장하면 여기에 표시됩니다</span>
          </div>
        ) : (
          <ul className="sidebar-work-list">
            {recurringWorks.map((work) => (
              <li key={work.id} className={'sidebar-work-row ' + (work.active ? '' : 'paused')}>
                <button
                  type="button"
                  className="sidebar-work-item"
                  onClick={() => onOpenWork(work.id)}
                  aria-label={`${work.name} 반복 업무 열기`}
                >
                  <span className="sidebar-work-name">{work.name}</span>
                  <span className="sidebar-work-trigger">{triggerLabel(work.trigger)}</span>
                  <span className="sidebar-work-meta">
                    <span className={'sidebar-work-status ' + (work.active ? 'on' : 'off')}>
                      <span className="sidebar-work-status-dot" aria-hidden="true" />
                      {work.active ? '자동 실행 중' : '일시정지'}
                    </span>
                    <span className="sidebar-work-last-run">
                      {work.lastStatus
                        ? `최근 ${executionStatusLabel(work.lastStatus)} · ${formatRelativeTime(work.lastRunAt)}`
                        : '아직 실행 기록 없음'}
                    </span>
                  </span>
                </button>
                <div className="sidebar-work-actions">
                  <button
                    type="button"
                    className={'sidebar-work-toggle ' + (work.active ? 'on' : 'off')}
                    onClick={() => onToggleWorkActive(work.id, !work.active)}
                    title={work.active ? '자동 실행 일시정지' : '자동 실행 켜기'}
                  >
                    {work.active ? '정지' : '켜기'}
                  </button>
                  <button
                    type="button"
                    className="sidebar-session-delete"
                    onClick={() => onDeleteWork(work.id, work.name)}
                    aria-label={work.name + ' 업무 삭제'}
                    title="업무 삭제"
                  >
                    <IconTrash />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="sidebar-work-group" aria-labelledby="sidebar-single-run-title">
        <div className="sidebar-work-group-header">
          <div>
            <h2 id="sidebar-single-run-title" className="sidebar-section-title">
              단일 업무·최근 실행
            </h2>
            <p className="sidebar-work-group-subtitle">한 번 실행하는 업무와 결과를 봅니다</p>
          </div>
          <span className="sidebar-work-count" aria-label={`단일 업무와 최근 실행 ${oneOffCount}개`}>
            {oneOffCount}
          </span>
        </div>

        {oneOffCount === 0 ? (
          <div className="sidebar-work-empty">
            <p>단일 실행이 없습니다</p>
            <span>새 대화에서 한 번 실행할 업무를 요청해 보세요</span>
          </div>
        ) : (
          <>
            {oneOffWorks.length > 0 && (
              <div className="sidebar-work-subgroup">
                <p className="sidebar-work-subgroup-title">저장된 단일 업무</p>
                <ul className="sidebar-work-list">
                  {oneOffWorks.map((work) => (
                    <li key={work.id} className={'sidebar-work-row ' + (work.active ? '' : 'paused')}>
                      <button
                        type="button"
                        className="sidebar-work-item"
                        onClick={() => onOpenWork(work.id)}
                        aria-label={`${work.name} 단일 업무 열기`}
                      >
                        <span className="sidebar-work-name">{work.name}</span>
                        <span className="sidebar-work-trigger">{triggerLabel(work.trigger)}</span>
                        <span className="sidebar-work-meta">
                          <span className={'sidebar-work-status ' + (work.active ? 'on' : 'off')}>
                            <span className="sidebar-work-status-dot" aria-hidden="true" />
                            {work.active ? '실행 가능' : '일시정지'}
                          </span>
                          <span className="sidebar-work-last-run">
                            {work.lastStatus
                              ? `최근 ${executionStatusLabel(work.lastStatus)} · ${formatRelativeTime(work.lastRunAt)}`
                              : '아직 실행 기록 없음'}
                          </span>
                        </span>
                      </button>
                      <div className="sidebar-work-actions">
                        <button
                          type="button"
                          className={'sidebar-work-toggle ' + (work.active ? 'on' : 'off')}
                          onClick={() => onToggleWorkActive(work.id, !work.active)}
                          title={work.active ? '업무 일시정지' : '업무 켜기'}
                        >
                          {work.active ? '정지' : '켜기'}
                        </button>
                        <button
                          type="button"
                          className="sidebar-session-delete"
                          onClick={() => onDeleteWork(work.id, work.name)}
                          aria-label={work.name + ' 업무 삭제'}
                          title="업무 삭제"
                        >
                          <IconTrash />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {singleExecutions.length > 0 && (
              <div className="sidebar-work-subgroup">
                <p className="sidebar-work-subgroup-title">최근 실행 결과</p>
                <ul className="sidebar-execution-list">
                  {singleExecutions.map((execution) => {
                    const presentation = executionPresentation(execution);
                    const title = executionTitle(execution, sessions);
                    return (
                      <li key={execution.id}>
                        <button
                          type="button"
                          className={`sidebar-execution-item tone-${presentation.tone}`}
                          onClick={() => onOpenExecution(execution)}
                          aria-label={`${title}, ${presentation.label}, ${execution.workspaceSessionId ? '결과 대화 보기' : '활동에서 보기'}`}
                        >
                          <span className={`sidebar-execution-dot tone-${presentation.tone}`} aria-hidden="true" />
                          <span className="sidebar-execution-copy">
                            <span className="sidebar-execution-title">{title}</span>
                            <span className="sidebar-execution-meta">
                              <strong>{presentation.label}</strong>
                              <span>·</span>
                              <span>{formatRelativeTime(execution.startedAt)}</span>
                            </span>
                            <span className="sidebar-execution-detail">{executionDetail(execution)}</span>
                          </span>
                          <span className="sidebar-execution-open" aria-hidden="true">보기</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
