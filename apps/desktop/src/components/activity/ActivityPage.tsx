import type { AppState } from '../../types/app-state';
import { PageHeader } from '../layout/PageHeader';
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
    explaining,
    exportingId,
    exportedId,
    exportError,
    askExplain,
    deleteExecution,
    clearExecutions,
    exportPdf,
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
        <div className={`ask-bar${canExplain ? '' : ' ask-bar--disabled'}`}>
          <input
            value={explainQ}
            onChange={(e) => setExplainQ(e.target.value)}
            placeholder="실행이 멈췄거나 실패한 이유를 물어보세요"
            disabled={!canExplain || explaining}
            onKeyDown={(e) => e.key === 'Enter' && void askExplain()}
          />
          <button
            type="button"
            className="btn btn-primary"
            onClick={() => void askExplain()}
            disabled={!canExplain || explaining}
          >
            {explaining ? '분석 중…' : '묻기'}
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
          실행마다 결과가 따로 기록됩니다. 수동 실행 실패와 Gmail·Slack 트리거 실행 성공은 별개일 수 있습니다.
        </p>

        <div className="timeline" style={{ marginTop: 16 }}>
          {executions.length === 0 ? (
            <div className="empty-state">
              <p>아직 실행 기록이 없습니다</p>
              <p className="muted">업무를 저장하거나 트리거가 발생하면 여기에 표시됩니다.</p>
            </div>
          ) : (
            executions.map((execution) => (
              <ActivityExecutionItem
                key={execution.id}
                execution={execution}
                skillName={state?.works.find((skill) => skill.id === execution.workflowId)?.name}
                deleting={busyId === execution.id}
                clearing={clearing}
                exporting={exportingId !== null}
                isExporting={exportingId === execution.id}
                exported={exportedId === execution.id}
                exportError={exportError?.executionId === execution.id ? exportError.message : undefined}
                onDelete={() => void deleteExecution(execution.id)}
                onExportPdf={(artifactId) => void exportPdf(execution.id, artifactId)}
              />
            ))
          )}
        </div>
      </div>
    </>
  );
}
