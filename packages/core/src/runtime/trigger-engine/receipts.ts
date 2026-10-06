import type { WorkflowStore } from '../../persistence/workflow-store.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import { isExternalAction } from '../execution/contracts.js';
import type { ExecutionResult } from '../types.js';

/** A trigger event is attempted at most this many times before it is dead-lettered. */
export const MAX_TRIGGER_ATTEMPTS = 5;
export const TRIGGER_RETRY_BASE_MS = 30_000;
export const TRIGGER_RETRY_MAX_MS = 30 * 60_000;
const MAX_DEAD_LETTERS = 100;

const ATTEMPT_SETTING_PREFIX = 'trigger.receiptAttempt:';
export const DEAD_LETTER_SETTING = 'trigger.deadLetters';

/** Runtime refusals raised before any step runs; the event is retried without counting. */
const NOT_STARTED_ERRORS = new Set([
  'runtime_stopping', 'workflow_removed', 'workflow_run_queue_full', 'workflow_already_running',
]);

type AttemptState = { attempts: number; nextAttemptAt: number };

export interface TriggerDeadLetter {
  dedupeKey: string;
  workflowId: string;
  attempts: number;
  reason: string;
  executionId?: string;
  at: string;
}

function attemptKey(dedupeKey: string): string {
  return `${ATTEMPT_SETTING_PREFIX}${encodeURIComponent(dedupeKey)}`;
}

function readAttempts(store: WorkflowStore, dedupeKey: string): AttemptState | undefined {
  const value = store.getSetting<unknown>(attemptKey(dedupeKey), undefined);
  if (!value || typeof value !== 'object') return undefined;
  const { attempts, nextAttemptAt } = value as Record<string, unknown>;
  if (typeof attempts !== 'number' || !Number.isFinite(attempts)) return undefined;
  return { attempts, nextAttemptAt: typeof nextAttemptAt === 'number' ? nextAttemptAt : 0 };
}

export function triggerErrorNotStarted(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code ?? (error instanceof Error ? error.message : undefined);
  return typeof code === 'string' && NOT_STARTED_ERRORS.has(code);
}

/** True while a failed event is waiting for its exponential backoff window. */
export function triggerRetryBlocked(store: WorkflowStore, dedupeKey: string, now = Date.now()): boolean {
  const state = readAttempts(store, dedupeKey);
  return Boolean(state && state.nextAttemptAt > now);
}

export function clearTriggerAttempts(store: WorkflowStore, dedupeKey: string): void {
  store.deleteSetting(attemptKey(dedupeKey));
}

/**
 * True when the run may already have produced an external side effect: an
 * external action completed, or started and then timed out/was cancelled
 * (outcome unknown). Such a run is never retried automatically.
 */
export function externalEffectPossible(result: Partial<ExecutionResult> | undefined, workflow: WorkflowIR): boolean {
  if (!result?.log) return false;
  const steps = new Map(workflow.steps.map((step) => [step.id, step]));
  const unknownOutcome = result.errorCode === 'step_timeout' || result.errorCode === 'cancelled' || result.status === 'cancelled';
  return result.log.some((entry) => {
    const stepId = (entry.data as { stepId?: unknown } | undefined)?.stepId;
    const step = typeof stepId === 'string' ? steps.get(stepId) : undefined;
    if (!step || !isExternalAction(step, workflow)) return false;
    return entry.code === 'step_completed' || (entry.code === 'step_started' && unknownOutcome);
  });
}

function recordDeadLetter(store: WorkflowStore, letter: TriggerDeadLetter): void {
  try {
    const stored = store.getSetting<unknown>(DEAD_LETTER_SETTING, []);
    const letters = Array.isArray(stored) ? stored : [];
    store.setSetting(DEAD_LETTER_SETTING, [...letters, letter].slice(-MAX_DEAD_LETTERS));
  } catch (error) {
    console.error('[trigger-engine] failed to record dead letter:', error);
  }
}

/**
 * Records a failed trigger run. Returns `dead` when the event must never be
 * retried (attempt cap reached, or an external side effect may have happened);
 * the receipt is then terminal so later events are not blocked. Otherwise the
 * receipt is released for a retry after exponential backoff.
 */
export function recordTriggerFailure(
  store: WorkflowStore,
  params: { dedupeKey: string; workflowId: string; workflow: WorkflowIR; result?: Partial<ExecutionResult>; reason: string },
  now = Date.now(),
): 'retry' | 'dead' {
  const attempts = (readAttempts(store, params.dedupeKey)?.attempts ?? 0) + 1;
  const external = externalEffectPossible(params.result, params.workflow);
  if (external || attempts >= MAX_TRIGGER_ATTEMPTS) {
    const reason = external ? 'external_effect_possible' : 'max_attempts_exceeded';
    store.deadLetterTriggerReceipt(params.dedupeKey, params.result?.executionId);
    clearTriggerAttempts(store, params.dedupeKey);
    recordDeadLetter(store, {
      dedupeKey: params.dedupeKey, workflowId: params.workflowId, attempts, reason,
      ...(params.result?.executionId ? { executionId: params.result.executionId } : {}),
      at: new Date(now).toISOString(),
    });
    console.error(`[trigger-engine] dead-lettered event ${params.dedupeKey} for workflow ${params.workflowId} after ${attempts} attempt(s): ${reason} (${params.reason})`);
    return 'dead';
  }
  store.failTriggerReceipt(params.dedupeKey);
  const delay = Math.min(TRIGGER_RETRY_BASE_MS * 2 ** (attempts - 1), TRIGGER_RETRY_MAX_MS);
  store.setSetting(attemptKey(params.dedupeKey), { attempts, nextAttemptAt: now + delay } satisfies AttemptState);
  return 'retry';
}
