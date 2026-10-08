import {
  DEAD_LETTER_SETTING,
  LAST_OUTCOME_SETTING_PREFIX,
  TRIGGER_POLL_FAILURE_PREFIX,
  type CorruptRowReport,
  type TriggerPollFailure,
  type SchedulerOccurrenceOutcome,
  type TriggerDeadLetter,
} from '@ax-studio/core';
import type { AxCore } from '../../core-instance.js';

const MAX_CORRUPT_ROWS = 50;
const MAX_DEAD_LETTERS_PER_WORKFLOW = 10;

export interface CorruptRowSummary {
  total: number;
  byTable: Record<string, number>;
  /** Newest first, at most 50; identifiers and error codes only (never row payloads). */
  rows: CorruptRowReport[];
}

export interface WorkflowAutomationHealth {
  /** Dead-lettered trigger events for this workflow, newest first (at most 10). */
  triggerDeadLetters: Array<Omit<TriggerDeadLetter, 'workflowId'>>;
  /** Last failed/skipped scheduled occurrence, if any. */
  lastOutcome?: SchedulerOccurrenceOutcome;
  /** Checking for new mail/messages/files keeps failing (cleared by the next successful check). */
  triggerPollFailure?: TriggerPollFailure;
}

function isPollFailure(value: unknown): value is TriggerPollFailure {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return ['code', 'message', 'firstFailedAt', 'lastFailedAt'].every((field) => typeof entry[field] === 'string');
}

export function buildCorruptRowSummary(core: Pick<AxCore, 'store'>): CorruptRowSummary {
  let reports: CorruptRowReport[] = [];
  try {
    reports = core.store.listCorruptRows();
  } catch {
    reports = [];
  }
  const byTable: Record<string, number> = {};
  for (const report of reports) byTable[report.table] = (byTable[report.table] ?? 0) + 1;
  const rows = [...reports].sort((left, right) => right.detectedAt.localeCompare(left.detectedAt)).slice(0, MAX_CORRUPT_ROWS);
  return { total: reports.length, byTable, rows };
}

function isDeadLetter(value: unknown): value is TriggerDeadLetter {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.workflowId === 'string' && typeof entry.dedupeKey === 'string'
    && typeof entry.attempts === 'number' && typeof entry.reason === 'string' && typeof entry.at === 'string'
    && (entry.executionId === undefined || typeof entry.executionId === 'string');
}

function isOccurrenceOutcome(value: unknown): value is SchedulerOccurrenceOutcome {
  if (!value || typeof value !== 'object') return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.occurrenceKey === 'string' && typeof entry.status === 'string' && typeof entry.at === 'string'
    && (entry.reason === undefined || typeof entry.reason === 'string')
    && (entry.executionId === undefined || typeof entry.executionId === 'string');
}

function readSetting(core: Pick<AxCore, 'store'>, key: string, fallback: unknown): unknown {
  try {
    return core.store.getSetting<unknown>(key, fallback);
  } catch {
    return fallback;
  }
}

/** Per-workflow trigger/scheduler health, keyed by workflow id. Malformed entries are ignored. */
export function buildWorkflowAutomationHealth(
  core: Pick<AxCore, 'store'>,
  workflowIds: readonly string[],
): Map<string, WorkflowAutomationHealth> {
  const stored = readSetting(core, DEAD_LETTER_SETTING, []);
  const letters = Array.isArray(stored) ? stored.filter(isDeadLetter) : [];
  const health = new Map<string, WorkflowAutomationHealth>();
  for (const workflowId of workflowIds) {
    const triggerDeadLetters = letters
      .filter((letter) => letter.workflowId === workflowId)
      .sort((left, right) => right.at.localeCompare(left.at))
      .slice(0, MAX_DEAD_LETTERS_PER_WORKFLOW)
      .map(({ workflowId: _workflowId, ...letter }) => letter);
    const outcome = readSetting(core, `${LAST_OUTCOME_SETTING_PREFIX}${encodeURIComponent(workflowId)}`, undefined);
    const pollFailure = readSetting(core, `${TRIGGER_POLL_FAILURE_PREFIX}${encodeURIComponent(workflowId)}`, undefined);
    health.set(workflowId, {
      triggerDeadLetters,
      ...(isOccurrenceOutcome(outcome) ? { lastOutcome: outcome } : {}),
      ...(isPollFailure(pollFailure) ? { triggerPollFailure: pollFailure } : {}),
    });
  }
  return health;
}
