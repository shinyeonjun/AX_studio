import { useState } from 'react';
import type { AppState } from '../../../types/app-state';
import type { ChatSessionSummary } from '../../../features/chat/hooks/useChatSessions';
import { isEphemeralWork, isPersistentWork, isSingleExecution, triggerLabel } from '../../lib/work-display';
import {
  DeleteWorkButton,
  EmptyWorkGroup,
  LastRun,
  RunWorkButton,
  WorkGroup,
  WorkHealthNote,
} from './work-panel/components';
import { ExecutionList, type ExecutionSummary } from './work-panel/execution-list';

export { WorkHealthNote } from './work-panel/components';

interface SidebarWorkPanelProps {
  state: AppState | null;
  sessions: ChatSessionSummary[];
  onOpenWork: (workflowId: string) => void;
  onOpenExecution: (execution: ExecutionSummary) => void;
  onToggleWorkActive: (workflowId: string, active: boolean) => void;
  /** Runs a saved workflow now; resolves when the run has finished or waits for approval. */
  onRunWork: (workflowId: string) => Promise<void>;
  onDeleteWork: (workflowId: string, name: string) => void;
}

/** Works being run from the sidebar, so each run button shows progress until its run returns. */
function useRunningWorks(onRunWork: SidebarWorkPanelProps['onRunWork']) {
  const [running, setRunning] = useState<ReadonlySet<string>>(new Set());
  const runWork = (workflowId: string) => {
    if (running.has(workflowId)) return;
    setRunning((current) => new Set(current).add(workflowId));
    void onRunWork(workflowId).finally(() => {
      setRunning((current) => {
        const next = new Set(current);
        next.delete(workflowId);
        return next;
      });
    });
  };
  return { running, runWork };
}

export function SidebarWorkPanel({
  state,
  sessions,
  onOpenWork,
  onOpenExecution,
  onToggleWorkActive,
  onRunWork,
  onDeleteWork,
}: SidebarWorkPanelProps) {
  const { running, runWork } = useRunningWorks(onRunWork);
  const allWorks = state?.works ?? [];
  // A corrupted workflow has no readable definition (no trigger), so it must not be
  // classified or opened like a normal one; it is listed separately for deletion.
  const corruptedWorks = allWorks.filter((work) => work.corrupted);
  const works = allWorks.filter((work) => !work.corrupted);
  const recurringWorks = works.filter((work) => isPersistentWork(work.trigger));
  const oneOffWorks = works.filter((work) => isEphemeralWork(work.trigger));
  const singleExecutions = (state?.executions ?? [])
    .filter(isSingleExecution)
    .slice(0, 6);
  const oneOffCount = oneOffWorks.length + singleExecutions.length;

  return (
    <div className="sidebar-panel-section sidebar-work-overview">
      {corruptedWorks.length > 0 && (
        <WorkGroup
          id="sidebar-corrupted-work-title"
          title="손상된 업무"
          subtitle="저장된 정의를 읽지 못해 실행되지 않습니다. 삭제한 뒤 다시 만들어 주세요."
          count={corruptedWorks.length}
          countLabel="손상된 업무"
        >
          <ul className="sidebar-work-list">
            {corruptedWorks.map((work) => {
              const name = work.name?.trim() || work.id;
              return (
                <li key={work.id} className="sidebar-work-row paused">
                  <div className="sidebar-work-item sidebar-work-item--static">
                    <span className="sidebar-work-name">{name}</span>
                    <span className="sidebar-work-trigger">손상된 업무 · 열 수 없음</span>
                  </div>
                  <div className="sidebar-work-actions">
                    <DeleteWorkButton label={name + ' 손상된 업무 삭제'} title="손상된 업무 삭제"
                      onDelete={() => onDeleteWork(work.id, name)} />
                  </div>
                </li>
              );
            })}
          </ul>
        </WorkGroup>
      )}

      <WorkGroup
        id="sidebar-recurring-work-title"
        title="반복 업무"
        subtitle="활성화하면 일정에 맞춰 자동 실행됩니다"
        count={recurringWorks.length}
        countLabel="반복 업무"
      >
        {recurringWorks.length === 0 ? (
          <EmptyWorkGroup title="반복 업무가 없습니다" hint="업무를 저장하면 여기에 표시됩니다" />
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
                      {work.active ? '자동 실행 중' : '자동 실행 꺼짐'}
                    </span>
                    <LastRun work={work} />
                  </span>
                  <WorkHealthNote work={work} />
                </button>
                <div className="sidebar-work-actions">
                  <RunWorkButton workId={work.id} name={work.name} running={running} onRun={runWork} />
                  <button
                    type="button"
                    className={'sidebar-work-toggle ' + (work.active ? 'on' : 'off')}
                    onClick={() => onToggleWorkActive(work.id, !work.active)}
                    aria-label={`${work.name} 자동 실행 ${work.active ? '끄기' : '켜기'}`}
                    title={work.active ? '자동 실행 끄기' : '자동 실행 켜기'}
                  >
                    {work.active ? '끄기' : '켜기'}
                  </button>
                  <DeleteWorkButton label={work.name + ' 업무 삭제'} title="업무 삭제"
                    onDelete={() => onDeleteWork(work.id, work.name)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </WorkGroup>

      <WorkGroup
        id="sidebar-single-run-title"
        title="직접 실행·한 번 예약"
        subtitle="필요할 때 실행하는 업무와 최근 결과를 봅니다"
        count={oneOffCount}
        countLabel="직접 실행 업무와 최근 실행"
      >
        {oneOffCount === 0 ? (
          <EmptyWorkGroup title="아직 실행한 업무가 없습니다" hint="새 대화에서 할 일을 요청해 보세요" />
        ) : (
          <>
            {oneOffWorks.length > 0 && (
              <div className="sidebar-work-subgroup">
                <p className="sidebar-work-subgroup-title">저장된 업무</p>
                <ul className="sidebar-work-list">
                  {oneOffWorks.map((work) => (
                    <li key={work.id} className="sidebar-work-row">
                      <button
                        type="button"
                        className="sidebar-work-item"
                        onClick={() => onOpenWork(work.id)}
                        aria-label={`${work.name} 업무 열기`}
                      >
                        <span className="sidebar-work-name">{work.name}</span>
                        <span className="sidebar-work-trigger">{triggerLabel(work.trigger)}</span>
                        <span className="sidebar-work-meta">
                          <LastRun work={work} />
                        </span>
                        <WorkHealthNote work={work} />
                      </button>
                      <div className="sidebar-work-actions">
                        {/* A manual work only runs when asked: on/off would change nothing. */}
                        <RunWorkButton workId={work.id} name={work.name} running={running} onRun={runWork} />
                        <DeleteWorkButton label={work.name + ' 업무 삭제'} title="업무 삭제"
                          onDelete={() => onDeleteWork(work.id, work.name)} />
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {singleExecutions.length > 0 && (
              <div className="sidebar-work-subgroup">
                <p className="sidebar-work-subgroup-title">최근 실행 결과</p>
                <ExecutionList executions={singleExecutions} sessions={sessions} onOpen={onOpenExecution} />
              </div>
            )}
          </>
        )}
      </WorkGroup>
    </div>
  );
}
