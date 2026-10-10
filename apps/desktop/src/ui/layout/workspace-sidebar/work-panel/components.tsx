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
        <h2 id={id} className="sidebar-section-title">{title}</h2>
        <span className="sidebar-work-count" aria-label={`${countLabel} ${count}개`}>{count}</span>
      </div>
      <p className="sidebar-work-group-subtitle">{subtitle}</p>
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
/** Failures the person must fix, shown at once; others only once they have lasted a while. */
const POLL_FAILURES_NEEDING_ACTION = new Set([
  'oauth_refresh_failed', 'gmail_scope_missing', 'invalid_auth', 'token_revoked', 'token_expired', 'missing_scope',
  'not_in_channel', 'channel_not_found', 'folder_not_found', 'folder_not_accessible', 'folder_not_directory', 'source_folder_not_found',
]);
const POLL_FAILURE_GRACE_MS = 5 * 60 * 1000;

/** A job whose "새 메일이 오면 …" check keeps failing would otherwise look healthy and never run. */
export function visiblePollFailure(work: Pick<WorkSummary, 'triggerPollFailure'>): WorkSummary['triggerPollFailure'] {
  const failure = work.triggerPollFailure;
  if (!failure) return undefined;
  const lasted = Date.parse(failure.lastFailedAt) - Date.parse(failure.firstFailedAt);
  return POLL_FAILURES_NEEDING_ACTION.has(failure.code) || lasted >= POLL_FAILURE_GRACE_MS ? failure : undefined;
}

export function WorkHealthNote({ work }: { work: Pick<WorkSummary, 'triggerDeadLetters' | 'lastOutcome' | 'triggerPollFailure'> }) {
  const deadLetters = work.triggerDeadLetters ?? [];
  const outcome = work.lastOutcome && work.lastOutcome.status !== 'success' ? work.lastOutcome : undefined;
  const pollFailure = visiblePollFailure(work);
  if (deadLetters.length === 0 && !outcome && !pollFailure) return null;
  const latest = deadLetters[0];
  return (
    <span className="sidebar-work-health" role="status">
      {pollFailure && (
        <span title={pollFailure.message}>
          자동 시작 확인 안 됨 · {pollFailure.message}
        </span>
      )}
      {outcome && (
        <span title={outcome.reason ? executionErrorLabel(outcome.reason) : undefined}>
          최근 일정 {outcome.status === 'skipped' ? '건너뜀' : executionStatusLabel(outcome.status)} ·{' '}
          {formatRelativeTime(outcome.at)}
        </span>
      )}
      {latest && (
        <span title={executionErrorLabel(latest.reason)}>
          놓친 자동 시작 {deadLetters.length}건 · {formatRelativeTime(latest.at)}
        </span>
      )}
    </span>
  );
}
