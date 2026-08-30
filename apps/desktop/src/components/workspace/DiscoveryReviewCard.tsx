import type { DiscoveryInspectView } from '@ax-studio/core';

interface DiscoveryReviewCardProps {
  view: DiscoveryInspectView;
  busy: boolean;
  onAnswer: (questionId: string, optionId: string) => Promise<void> | void;
  onPublish: () => Promise<void> | void;
  onCancel?: () => Promise<void> | void;
  onRetry?: () => Promise<void> | void;
}

const RUNNING_STATUSES = new Set<DiscoveryInspectView['status']>([
  'collecting_examples',
  'observing_output',
  'inventory_sources',
  'exploring_sources',
  'synthesizing',
  'validating',
  'publishing',
]);

export function DiscoveryReviewCard({ view, busy, onAnswer, onPublish, onCancel, onRetry }: DiscoveryReviewCardProps) {
  return (
    <div className="ax-discovery-review">
      <h3>찾은 방법</h3>
      <p className="muted">{view.progress}</p>
      {view.fieldReviews.length > 0 && (
        <section>
          <h4>필드별 학습 결과</h4>
          <ul className="ax-discovery-field-reviews">
            {view.fieldReviews.map((field) => (
              <li key={field.outputPath}>
                <strong>{field.label ?? field.outputPath}</strong>
                {field.display && <div>관찰값: {field.display}</div>}
                {field.sourceId && <div>데이터 출처: {field.sourceId}</div>}
                {field.mappingLabel && <div>학습한 규칙: {field.mappingLabel}</div>}
                {field.replayByExample.length > 0 && (
                  <div>
                    재현 결과:
                    <ul>
                      {field.replayByExample.map((entry) => (
                        <li key={entry.exampleId}>
                          {entry.exampleId} {entry.pass ? '✓' : '✗'} ({entry.actualDisplay})
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {field.confidence != null && (
                  <div>확신도: {(field.confidence * 100).toFixed(0)}%</div>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
      {view.observations.length > 0 && view.fieldReviews.length === 0 && (
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
          <h4>재현 요약</h4>
          <p>
            {view.replaySummary.passed}/{view.replaySummary.total} 후보 검증 통과
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
      {(RUNNING_STATUSES.has(view.status) && onCancel) || (view.status === 'needs_attention' && onRetry) ? (
        <div className="ax-discovery-review-actions">
          {RUNNING_STATUSES.has(view.status) && onCancel && (
            <button type="button" className="ax-discovery-review-btn" disabled={busy} onClick={() => void onCancel()}>
              중단하기
            </button>
          )}
          {view.status === 'needs_attention' && onRetry && (
            <button type="button" className="ax-discovery-review-btn" disabled={busy} onClick={() => void onRetry()}>
              다시 시도
            </button>
          )}
        </div>
      ) : null}
      {view.errorMessage && <p className="ax-workspace-error">{view.errorMessage}</p>}
    </div>
  );
}
