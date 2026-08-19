import { useState } from 'react';
import type { AppState } from '../../types/app-state';
import {
  executionErrorLabel,
  executionStatusLabel,
  executionTriggerLabel,
  formatRelativeTime,
} from '../../lib/work-display';
import { PageHeader } from '../layout/PageHeader';

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
  const [explainQ, setExplainQ] = useState('왜 오늘 안 했어?');
  const [explainA, setExplainA] = useState('');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [clearing, setClearing] = useState(false);

  const askExplain = async () => {
    setExplainA(await window.ax.explain(explainQ));
  };

  const deleteExecution = async (executionId: string) => {
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

  const executions = state?.executions ?? [];

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
        <div className="ask-bar">
          <input
            value={explainQ}
            onChange={(e) => setExplainQ(e.target.value)}
            placeholder="왜 오늘 안 했어?"
            onKeyDown={(e) => e.key === 'Enter' && askExplain()}
          />
          <button type="button" className="btn btn-primary" onClick={askExplain}>
            물어보기
          </button>
        </div>
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
              const failed = e.status === 'failed';
              const errorDetail = executionErrorLabel(e.errorCode);
              const deleting = busyId === e.id;
              return (
                <div key={e.id} className="timeline-item">
                  <div
                    className={`timeline-dot ${ok ? 'success' : failed ? 'failed' : running ? 'running' : ''}`}
                  >
                    {ok ? '✓' : failed ? '!' : running ? '…' : '·'}
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
