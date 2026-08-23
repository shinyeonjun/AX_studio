import type { DiscoveryInspectView } from '@ax-studio/core';

interface DiscoveryReviewCardProps {
  view: DiscoveryInspectView;
  busy: boolean;
  onAnswer: (questionId: string, optionId: string) => Promise<void> | void;
  onPublish: () => Promise<void> | void;
}

export function DiscoveryReviewCard({ view, busy, onAnswer, onPublish }: DiscoveryReviewCardProps) {
  return (
    <div className="ax-discovery-review">
      <h3>찾은 방법</h3>
      <p className="muted">{view.progress}</p>
      {view.observations.length > 0 && (
        <section>
          <h4>결과물에서 찾은 항목</h4>
          <ul>
            {view.observations.map((observation) => (
              <li key={observation.path}>
                {observation.label ?? observation.path}: {observation.display}
              </li>
            ))}
          </ul>
        </section>
      )}
      {view.replaySummary.total > 0 && (
        <section>
          <h4>재현 결과</h4>
          <p>
            {view.replaySummary.passed}/{view.replaySummary.total} 항목 재현 성공
          </p>
        </section>
      )}
      {view.pendingQuestion && (
        <section>
          <h4>{view.pendingQuestion.prompt}</h4>
          <div className="ax-discovery-options">
            {view.pendingQuestion.options.map((option) => (
              <button
                key={option.id}
                type="button"
                className="btn btn-sm"
                disabled={busy}
                onClick={() => void onAnswer(view.pendingQuestion!.id, option.id)}
              >
                {option.label}
              </button>
            ))}
          </div>
        </section>
      )}
      {view.publishable && (
        <button type="button" className="btn btn-primary" disabled={busy || view.status === 'published'} onClick={() => void onPublish()}>
          {view.status === 'published' ? '맡기기 완료' : '이대로 맡기기'}
        </button>
      )}
      {view.errorMessage && <p className="ax-workspace-error">{view.errorMessage}</p>}
    </div>
  );
}
