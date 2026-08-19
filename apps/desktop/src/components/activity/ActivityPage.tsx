import { useState } from 'react';
import type { AppState } from '../../types/app-state';
import { PageHeader } from '../layout/PageHeader';

interface ActivityPageProps {
  state: AppState | null;
}

export function ActivityPage({ state }: ActivityPageProps) {
  const [explainQ, setExplainQ] = useState('왜 오늘 안 했어?');
  const [explainA, setExplainA] = useState('');

  const askExplain = async () => {
    setExplainA(await window.ax.explain(explainQ));
  };

  return (
    <>
      <PageHeader title="활동" subtitle="실행 이력과 결과를 확인합니다" />
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

        <div className="timeline" style={{ marginTop: 24 }}>
          {state?.executions?.map((e) => {
            const skill = state.skills.find((s) => s.id === e.skillId);
            const ok = e.status === 'success';
            return (
              <div key={e.id} className="timeline-item">
                <div className={`timeline-dot ${ok ? 'success' : e.status === 'failed' ? 'failed' : ''}`}>
                  {ok ? '✓' : e.status === 'failed' ? '!' : '·'}
                </div>
                <div className="timeline-body">
                  <div className="timeline-time">{e.startedAt}</div>
                  <div className="timeline-status">
                    {skill?.name ?? '일회 실행'} — {e.status}
                  </div>
                  <div className="muted">
                    {e.triggerType ?? 'manual'}
                    {e.errorCode ? ` · ${e.errorCode}` : ''}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}
