import type { DiscoveryInspectView } from '@ax-studio/core';
import { DISCOVERY_RUNNING_STATUSES } from './workspace-flow/status.js';

interface DiscoveryReviewCardProps {
  view: DiscoveryInspectView;
  busy: boolean;
  onAnswer: (questionId: string, optionId: string) => Promise<void> | void;
  onPublish: () => Promise<void> | void;
  onCancel?: () => Promise<void> | void;
  onRetry?: () => Promise<void> | void;
}

const CANCELLABLE_STATUSES = new Set<DiscoveryInspectView['status']>([
  ...DISCOVERY_RUNNING_STATUSES,
  'needs_attention',
  'needs_clarification',
  'ready_to_publish',
]);

/** "sheet:<folder>:D%3A%5C...%5C주문내역.xlsx" -> "주문내역.xlsx"; other ids stay as they are. */
export function discoverySourceLabel(sourceId: string): string {
  const match = /^(?:sheet|file|doc):[^:]*:(.+)$/u.exec(sourceId);
  if (!match) return sourceId.replace(/^(rdb|sheet):/u, '');
  let path = match[1]!;
  try { path = decodeURIComponent(path); } catch { /* keep the raw value */ }
  return path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path;
}

export function DiscoveryReviewCard({ view, busy, onAnswer, onPublish, onCancel, onRetry }: DiscoveryReviewCardProps) {
  // Internal example ids mean nothing to users; number them in the order they first appear.
  const exampleNumbers = new Map<string, number>();
  for (const field of view.fieldReviews) {
    for (const entry of field.replayByExample) {
      if (!exampleNumbers.has(entry.exampleId)) exampleNumbers.set(entry.exampleId, exampleNumbers.size + 1);
    }
  }
  return (
    <div className="ax-discovery-review" data-discovery-status={view.status}>
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
                {field.sourceId && <div>데이터 출처: {discoverySourceLabel(field.sourceId)}</div>}
                {field.mappingLabel && <div>학습한 규칙: {field.mappingLabel}</div>}
                {field.replayByExample.length > 0 && (
                  <div>
                    재현 결과:
                    <ul>
                      {field.replayByExample.map((entry) => (
                        <li key={entry.exampleId}>
                          예시 {exampleNumbers.get(entry.exampleId)} {entry.pass ? '✓' : '✗'} ({entry.actualDisplay})
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
            예시와 같은 값을 낸 방법 {view.replaySummary.passed}/{view.replaySummary.total}개
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
      {view.publishable && view.sourceNotice && (
        <p className="ax-discovery-source-notice" role="note">{view.sourceNotice}</p>
      )}
      {view.publishable && (
        <button type="button" className="btn btn-primary" disabled={busy || view.status === 'published'} onClick={() => void onPublish()}>
          {view.status === 'published' ? '맡기기 완료' : '이대로 맡기기'}
        </button>
      )}
      {(CANCELLABLE_STATUSES.has(view.status) && onCancel) || (view.status === 'needs_attention' && onRetry) ? (
        <div className="ax-discovery-review-actions">
          {CANCELLABLE_STATUSES.has(view.status) && onCancel && (
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
