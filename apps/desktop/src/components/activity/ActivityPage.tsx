import { useState } from 'react';
import type { AppState } from '../../types/app-state';
import {
  executionErrorLabel,
  executionStatusLabel,
  executionTriggerLabel,
  formatRelativeTime,
} from '../../lib/work-display';
import { PageHeader } from '../layout/PageHeader';
import { confirmDeleteExecution } from '../../lib/confirm-delete';
import { ipcErrorMessage } from '../../lib/ipc-error';

interface ActivityPageProps {
  state: AppState | null;
  onRefresh: () => Promise<void>;
}

function formatTimestamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString('ko-KR', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function ActivityPage({ state, onRefresh }: ActivityPageProps) {
  const [explainQ, setExplainQ] = useState('실행이 멈췄거나 실패한 이유를 물어보세요');
  const [explainA, setExplainA] = useState('');
  const [explainError, setExplainError] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);
  const [explaining, setExplaining] = useState(false);

  const executions = state?.executions ?? [];
  const canExplain = executions.length > 0;

  const askExplain = async () => {
    if (!canExplain) return;
    setExplaining(true);
    setExplainError('');
    try {
      setExplainA(await window.ax.explain(explainQ));
    } catch (err) {
      setExplainError(ipcErrorMessage(err, '실행 기록을 분석하지 못했습니다.'));
    } finally {
      setExplaining(false);
    }
  };

  const deleteExecution = async (executionId: string) => {
    if (!confirmDeleteExecution()) return;
    setBusyId(executionId);
    try {
      await window.ax.deleteExecution(executionId);
      await onRefresh();
    } catch (err) {
      window.alert(err instanceof Error ? err.message : '기록을 삭제하지 못했습니다.');
    } finally {
      setBusyId(null);
    }
  };

  const clearExecutions = async () => {
    const count = state?.executions?.length ?? 0;
    if (count === 0) return;
    if (!window.confirm(`실행 기록 ${count}건을 지울까요?\n승인 대기 중인 실행은 남겨둡니다.`)) return;
    setClearing(true);
    try {
      await window.ax.clearExecutions();
      await onRefresh();
    } finally {
      setClearing(false);
    }
  };

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
            executions.map((e) => {
              const skill = state?.works.find((s) => s.id === e.workflowId);
              const ok = e.status === 'success';
              const running = e.status === 'running';
              const pending = e.status === 'pending_approval';
              const failed = e.status === 'failed';
              const errorDetail = executionErrorLabel(e.errorCode);
              const deleting = busyId === e.id;
              return (
                <div key={e.id} className="timeline-item">
                  <div
                    className={`timeline-dot ${ok ? 'success' : failed ? 'failed' : pending ? 'pending' : running ? 'running' : ''}`}
                  >
                    {ok ? '✓' : failed ? '!' : pending ? '!' : running ? '…' : '·'}
                  </div>
                  <div className="timeline-body">
                    <div className="timeline-body-header">
                      <div className="timeline-time">
                        {formatRelativeTime(e.startedAt)} · {formatTimestamp(e.startedAt)}
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost btn-danger-text timeline-delete"
                        onClick={() => void deleteExecution(e.id)}
                        disabled={deleting || clearing}
                        aria-label="기록 삭제"
                        title="기록 삭제"
                      >
                        {deleting ? '…' : '삭제'}
                      </button>
                    </div>
                    <div className="timeline-status">
                      {skill?.name ?? '일회 실행'} — {executionStatusLabel(e.status)}
                    </div>
                    <div className="muted">
                      {executionTriggerLabel(e.triggerType)}
                      {errorDetail ? ` · ${errorDetail}` : ''}
                      {e.errorMessage && e.errorMessage !== errorDetail ? ` · ${e.errorMessage}` : ''}
                    </div>
                    {e.currentStepId && (
                      <div className="timeline-step">
                        현재 단계 · {e.currentStepId}
                        {e.currentStepMessage ? ` · ${e.currentStepMessage}` : ''}
                      </div>
                    )}
                    {e.lastLogMessage && !e.currentStepMessage && (
                      <div className="timeline-step">최근 기록 · {e.lastLogMessage}</div>
                    )}
                    {e.aiOutput && (
                      <div className="timeline-step">
                        AI 분석 결과 · {e.aiOutput.fields.length > 0 ? e.aiOutput.fields.join(', ') : '출력 없음'}
                        {Object.entries(e.aiOutput.preview).map(([field, value]) => (
                          <div key={field}>
                            {field}: {value || '(빈 값)'}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
