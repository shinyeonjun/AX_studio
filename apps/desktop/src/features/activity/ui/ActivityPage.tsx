import type { AppState } from '../../../types/app-state';
import { PageHeader } from '../../../ui/layout/PageHeader';
import { ActivityExecutionItem } from './activity-execution-item.js';
import { useActivityActions } from './use-activity-actions.js';

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
    exportPdf,
    savePdfToFolder,
  } = useActivityActions({ state, onRefresh });

  return (
    <>
      <PageHeader
        title="활동"
        subtitle="실행 이력과 결과를 확인합니다"
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
      <div className="page-content">
        {clearError && <div className="approval-error" role="alert">{clearError}</div>}
        <div className={`ask-bar${canExplain ? '' : ' ask-bar--disabled'}`}>
          <input
            aria-label="실행 결과에 대해 AI에게 물어볼 내용"
            value={explainQ}
            onChange={(e) => setExplainQ(e.target.value)}
            placeholder="실행이 멈췄거나 실패한 이유를 물어보세요"
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

        <p className="muted activity-hint">
          실행할 때마다 결과가 따로 남아요. 직접 실행이 실패해도 Gmail·Slack 자동 시작으로 실행된 업무는 성공했을 수 있어요.
        </p>

        <div className="timeline" style={{ marginTop: 16 }}>
          {executions.length === 0 ? (
            <div className="empty-state">
              <p>아직 실행 기록이 없습니다</p>
              <p className="muted">업무를 실행하거나 자동 시작 조건이 맞으면 여기에 표시됩니다.</p>
            </div>
          ) : (
            executions.map((execution) => (
              <ActivityExecutionItem
                key={execution.id}
                execution={execution}
                skillName={state?.works.find((skill) => skill.id === execution.workflowId)?.name ?? execution.name}
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
                onExportPdf={(artifactId) => void exportPdf(execution.id, artifactId)}
                onSavePdfToFolder={(artifactId) => void savePdfToFolder(execution.id, artifactId)}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}
