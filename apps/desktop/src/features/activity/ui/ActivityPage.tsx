import type { AppState } from '../../../types/app-state';
import { PageHeader } from '../../../ui/layout/PageHeader';
import { ActivityExecutionItem } from './activity-execution-item.js';
import { useActivityActions } from './use-activity-actions.js';
import { runWorkName } from '../../../ui/lib/work-display';
import { groupByDay } from './format.js';

interface ActivityPageProps {
  state: AppState | null;
  onRefresh: () => Promise<void>;
}

export function ActivityPage({ state, onRefresh }: ActivityPageProps) {
  const {
    executions,
    canExplain,
    explainQ,
    setExplainQ,
    explainA,
    explainError,
    busyId,
    clearing,
    clearError,
    explaining,
    exportingId,
    exportedId,
    exportError,
    savingToFolderId,
    savedToFolderId,
    folderSaveError,
    askExplain,
    deleteExecution,
    clearExecutions,
    exportFile,
    saveFileToFolder,
  } = useActivityActions({ state, onRefresh });

  return (
    <>
      <PageHeader
        title="활동"
        subtitle="실행 기록과 결과를 확인합니다"
        action={
          executions.length > 0 ? (
            <button
              type="button"
              className="btn btn-ghost btn-danger-text"
              onClick={() => void clearExecutions()}
              disabled={clearing}
            >
              {clearing ? '지우는 중…' : '기록 모두 지우기'}
            </button>
          ) : undefined
        }
      />
      <div className="page-content activity-page">
        {clearError && <div className="approval-error" role="alert">{clearError}</div>}
        <div className={`ask-bar${canExplain ? '' : ' ask-bar--disabled'}`}>
          <input
            aria-label="실행 결과에 대해 AI에게 물어볼 내용"
            value={explainQ}
            onChange={(e) => setExplainQ(e.target.value)}
            placeholder="실행 기록에 대해 물어보세요. 예: 어제 실패한 업무는 왜 멈췄어?"
            disabled={!canExplain || explaining}
            onKeyDown={(e) => {
              // Korean IME commits the composition with Enter; only a real Enter submits.
              if (e.key === 'Enter' && !e.nativeEvent.isComposing) void askExplain();
            }}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void askExplain()}
            disabled={!canExplain || explaining || !explainQ.trim()}
          >
            {explaining ? '분석 중…' : 'AI에게 물어보기'}
          </button>
        </div>
        {!canExplain && (
          <p className="muted activity-hint">실행 기록이 생기면 AI에게 실행 결과를 물어볼 수 있습니다.</p>
        )}
        {explainError && (
          <div className="approval-error" role="alert">
            {explainError}
          </div>
        )}
        {explainA && <div className="review-box">{explainA}</div>}

        <div className="timeline">
          {executions.length === 0 ? (
            <div className="empty-state">
              <p>아직 실행 기록이 없습니다</p>
              <p className="muted">업무를 실행하거나 자동 시작 조건이 맞으면 여기에 표시됩니다.</p>
            </div>
          ) : (
            groupByDay(executions).map((group) => (
              <section key={group.label} className="timeline-day" aria-label={group.label}>
                <h2 className="timeline-day-label">{group.label}<span>{group.runs.length}건</span></h2>
                {group.runs.map((execution) => (
                  <ActivityExecutionItem
                    key={execution.id}
                    execution={execution}
                    skillName={runWorkName(execution, state?.works)}
                    deleting={busyId === execution.id}
                    clearing={clearing}
                    exporting={exportingId !== null}
                    isExporting={exportingId === execution.id}
                    exported={exportedId === execution.id}
                    exportError={exportError?.executionId === execution.id ? exportError.message : undefined}
                    savingToFolder={savingToFolderId !== null}
                    isSavingToFolder={savingToFolderId === execution.id}
                    savedToFolder={savedToFolderId === execution.id}
                    folderSaveError={folderSaveError?.executionId === execution.id ? folderSaveError.message : undefined}
                    onDelete={() => void deleteExecution(execution.id)}
                    onExportFile={(artifactId) => void exportFile(execution.id, artifactId)}
                    onSaveFileToFolder={(artifactId) => void saveFileToFolder(execution.id, artifactId)}
                  />
                ))}
              </section>
            ))
          )}
        </div>
      </div>
    </>
  );
}
