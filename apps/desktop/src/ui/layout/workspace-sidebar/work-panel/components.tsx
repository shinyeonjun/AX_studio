import type { ReactNode } from 'react';
import type { AppState } from '../../../../types/app-state';
import { executionErrorLabel, executionStatusLabel, formatRelativeTime } from '../../../lib/work-display';
import { IconTrash } from '../../../icons';

type WorkSummary = AppState['works'][number];

/** One titled group of the work panel with its count. */
export function WorkGroup({ id, title, subtitle, count, countLabel, children }: {
  id: string;
  title: string;
  subtitle: string;
  count: number;
  countLabel: string;
  children: ReactNode;
}) {
  return (
    <section className="sidebar-work-group" aria-labelledby={id}>
      <div className="sidebar-work-group-header">
        <div>
          <h2 id={id} className="sidebar-section-title">{title}</h2>
          <p className="sidebar-work-group-subtitle">{subtitle}</p>
        </div>
        <span className="sidebar-work-count" aria-label={`${countLabel} ${count}개`}>{count}</span>
      </div>
      {children}
    </section>
  );
}

export function EmptyWorkGroup({ title, hint }: { title: string; hint: string }) {
  return (
    <div className="sidebar-work-empty">
      <p>{title}</p>
      <span>{hint}</span>
    </div>
  );
}

export function RunWorkButton({ workId, name, running, onRun }: {
  workId: string;
  name: string;
  running: ReadonlySet<string>;
  onRun: (workflowId: string) => void;
}) {
  const busy = running.has(workId);
  return (
    <button
      type="button"
      className="sidebar-work-toggle run"
      onClick={() => onRun(workId)}
      disabled={busy}
      aria-label={`${name} 지금 실행`}
      title="지금 한 번 실행"
    >
      {busy ? '실행 중' : '실행'}
    </button>
  );
}

export function DeleteWorkButton({ label, title, onDelete }: { label: string; title: string; onDelete: () => void }) {
  return (
    <button type="button" className="sidebar-session-delete" onClick={onDelete} aria-label={label} title={title}>
      <IconTrash />
    </button>
  );
}

export function LastRun({ work }: { work: Pick<WorkSummary, 'lastStatus' | 'lastRunAt'> }) {
  return (
    <span className="sidebar-work-last-run">
      {work.lastStatus
        ? `최근 ${executionStatusLabel(work.lastStatus)} · ${formatRelativeTime(work.lastRunAt)}`
        : '아직 실행 기록 없음'}
    </span>
  );
}

/**
 * Scheduler skips/failures and trigger events that exhausted their retries. Nothing is shown
 * for a healthy workflow, so the row stays compact.
 */
export function WorkHealthNote({ work }: { work: Pick<WorkSummary, 'triggerDeadLetters' | 'lastOutcome'> }) {
  const deadLetters = work.triggerDeadLetters ?? [];
  const outcome = work.lastOutcome && work.lastOutcome.status !== 'success' ? work.lastOutcome : undefined;
  if (deadLetters.length === 0 && !outcome) return null;
  const latest = deadLetters[0];
  return (
    <span className="sidebar-work-health" role="status">
      {outcome && (
        <span title={outcome.reason ? executionErrorLabel(outcome.reason) ?? outcome.reason : undefined}>
          최근 일정 {outcome.status === 'skipped' ? '건너뜀' : executionStatusLabel(outcome.status)} ·{' '}
          {formatRelativeTime(outcome.at)}
        </span>
      )}
      {latest && (
        <span title={executionErrorLabel(latest.reason) ?? latest.reason}>
          처리하지 못한 트리거 이벤트 {deadLetters.length}건 · {formatRelativeTime(latest.at)}
        </span>
      )}
    </span>
  );
}
