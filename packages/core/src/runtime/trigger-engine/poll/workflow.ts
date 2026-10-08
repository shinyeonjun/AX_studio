import { connectorErrorMessage } from '../../../contracts/error-messages.js';
import { getTriggerHandler } from '../../../triggers/registry.js';
import { matchesTriggerFilter } from '../../../triggers/filter.js';
import type { TriggerCursor, TriggerEvent, TriggerPollResult } from '../../../triggers/types.js';
import type { WorkflowIR } from '../../../workflow/schema.js';
import type { ExecutionResult } from '../../types.js';
import {
  cursorAfterEvent,
  eventDedupeKey,
  legacyEventDedupeKeys,
  triggerInputFromEvent,
  triggerRunWasAccepted,
} from '../helpers.js';
import {
  clearTriggerAttempts,
  recordTriggerFailure,
  triggerErrorNotStarted,
  triggerRetryBlocked,
} from '../receipts.js';
import type { TriggerPollerOptions, TriggerPollState } from './contracts.js';
import { saveTriggerCursors } from './cursors.js';

type Trigger = NonNullable<WorkflowIR['trigger']>;

interface PollWorkflowParams {
  options: TriggerPollerOptions;
  generation: number;
  workflowId: string;
  workflow: WorkflowIR;
  trigger: Trigger;
  cursor: TriggerCursor;
  state: TriggerPollState;
  abortSignal?: AbortSignal;
}

async function awaitPollRead(
  read: () => Promise<TriggerPollResult>,
  signal?: AbortSignal,
): Promise<TriggerPollResult | undefined> {
  if (signal?.aborted) return undefined;
  let onAbort: (() => void) | undefined;
  let settleCancelled!: () => void;
  try {
    const cancelled = new Promise<undefined>((resolve) => {
      settleCancelled = () => resolve(undefined);
      onAbort = settleCancelled;
      signal?.addEventListener('abort', onAbort, { once: true });
    });
    return await Promise.race([read(), cancelled]);
  } finally {
    if (onAbort) signal?.removeEventListener('abort', onAbort);
    settleCancelled?.();
  }
}

/** What to do with one polled event. `stop` keeps the cursor before the event for a later retry. */
type EventOutcome = { kind: 'advance'; result?: unknown } | { kind: 'stop' };

function receiptCompleted(options: TriggerPollerOptions, workflowId: string, event: TriggerEvent, dedupeKey: string): boolean {
  return options.store.isTriggerReceiptCompleted(dedupeKey)
    || legacyEventDedupeKeys(workflowId, event).some((key) => options.store.isTriggerReceiptCompleted(key));
}

async function processPolledEvent(
  options: TriggerPollerOptions,
  workflowId: string,
  workflow: WorkflowIR,
  trigger: Trigger,
  event: TriggerEvent,
): Promise<EventOutcome> {
  const dedupeKey = eventDedupeKey(workflowId, event);
  if (dedupeKey && receiptCompleted(options, workflowId, event, dedupeKey)) return { kind: 'advance' };

  if (!matchesTriggerFilter(trigger, event)) {
    if (dedupeKey) options.rememberEvent(dedupeKey);
    return { kind: 'advance' };
  }

  // Preserve event order: a failed event in backoff holds back the events after it.
  if (dedupeKey && triggerRetryBlocked(options.store, dedupeKey)) return { kind: 'stop' };

  if (
    dedupeKey
    && !options.store.claimTriggerReceipt({
      dedupeKey,
      workflowId,
      triggerType: trigger.type,
    })
  ) {
    // Completed, dead-lettered or owned by another live run.
    return { kind: 'advance' };
  }

  let result: unknown;
  try {
    result = await options.runtime.executeWorkflow(workflow, {
      triggerType: trigger.type,
      input: triggerInputFromEvent(event),
    });
  } catch (err) {
    console.error(`[trigger-engine] poll execution failed for skill ${workflowId}:`, err);
    if (!dedupeKey) return { kind: 'stop' };
    if (triggerErrorNotStarted(err)) {
      options.store.failTriggerReceipt(dedupeKey);
      return { kind: 'stop' };
    }
    const decision = recordTriggerFailure(options.store, {
      dedupeKey, workflowId, workflow, reason: err instanceof Error ? err.message : String(err),
    });
    return decision === 'dead' ? { kind: 'advance' } : { kind: 'stop' };
  }
  if (!triggerRunWasAccepted(result)) {
    const status = (result as Partial<ExecutionResult>).status ?? 'unknown';
    console.error(`[trigger-engine] poll failed for skill ${workflowId}: trigger execution was not accepted: ${status}`);
    if (!dedupeKey) return { kind: 'stop' };
    const decision = recordTriggerFailure(options.store, {
      dedupeKey, workflowId, workflow, result: result as Partial<ExecutionResult>, reason: status,
    });
    return decision === 'dead' ? { kind: 'advance' } : { kind: 'stop' };
  }
  if (dedupeKey) {
    options.store.completeTriggerReceipt(dedupeKey, (result as ExecutionResult).executionId);
    clearTriggerAttempts(options.store, dedupeKey);
    options.rememberEvent(dedupeKey);
  }
  return { kind: 'advance', result };
}

/** Per workflow: why checking for new mail/messages/files keeps failing, until a check succeeds. */
export const TRIGGER_POLL_FAILURE_PREFIX = 'trigger.pollFailure:';

export interface TriggerPollFailure {
  /** The connector's code, e.g. oauth_refresh_failed or folder_not_accessible. */
  code: string;
  /** What to tell the person, already in words. */
  message: string;
  firstFailedAt: string;
  lastFailedAt: string;
}

function recordPollFailure(store: PollWorkflowParams['options']['store'], workflowId: string, err: unknown): void {
  const key = `${TRIGGER_POLL_FAILURE_PREFIX}${encodeURIComponent(workflowId)}`;
  const now = new Date().toISOString();
  const code = typeof (err as { code?: unknown } | null)?.code === 'string' ? (err as { code: string }).code : 'trigger_poll_failed';
  try {
    const previous = store.getSetting<TriggerPollFailure | undefined>(key, undefined);
    store.setSetting(key, {
      code,
      message: connectorErrorMessage(err instanceof Error ? err.message : String(err)),
      firstFailedAt: previous?.firstFailedAt ?? now,
      lastFailedAt: now,
    } satisfies TriggerPollFailure);
  } catch {
    // Recording health must never stop polling.
  }
}

function clearPollFailure(store: PollWorkflowParams['options']['store'], workflowId: string): void {
  try {
    store.deleteSetting(`${TRIGGER_POLL_FAILURE_PREFIX}${encodeURIComponent(workflowId)}`);
  } catch {
    // Recording health must never stop polling.
  }
}

export async function pollTriggerWorkflow({
  options,
  generation,
  workflowId,
  workflow,
  trigger,
  cursor,
  state,
  abortSignal,
}: PollWorkflowParams): Promise<boolean> {
  const handler = getTriggerHandler(trigger.type);
  if (!handler?.poll) return true;

  try {
    const pollResult = await awaitPollRead(() => handler.poll!({
      workflowId,
      trigger,
      cursor,
      connectors: options.runtime.connectors,
      abortSignal,
    }), abortSignal);
    if (!pollResult || abortSignal?.aborted || !options.isCurrentGeneration(generation)) return false;
    clearPollFailure(options.store, workflowId);

    let processedCursor: TriggerCursor = {
      ...cursor,
      initialized: pollResult.cursor.initialized ?? cursor.initialized,
      folderId: pollResult.cursor.folderId ?? cursor.folderId,
      channelId: pollResult.cursor.channelId ?? cursor.channelId,
    };
    for (const event of pollResult.events) {
      if (!options.isCurrentGeneration(generation)) return false;
      const outcome = await processPolledEvent(options, workflowId, workflow, trigger, event);
      if (outcome.kind === 'stop') return true;
      // Persist after every event so a crash never replays an acknowledged one.
      processedCursor = cursorAfterEvent(processedCursor, event);
      state.cursors[workflowId] = processedCursor;
      saveTriggerCursors(options.store, state.cursors, [workflowId]);
      state.dirtyWorkflowIds.delete(workflowId);
      if (outcome.result !== undefined) {
        if (!options.isCurrentGeneration(generation)) return false;
        options.onTriggeredRun?.(workflowId, outcome.result);
      }
    }

    if (JSON.stringify(pollResult.cursor) !== JSON.stringify(processedCursor)) {
      state.cursors[workflowId] = pollResult.cursor;
      state.dirtyWorkflowIds.add(workflowId);
    }
  } catch (err) {
    console.error(`[trigger-engine] poll failed for skill ${workflowId}:`, err);
    // A job whose "새 메일이 오면" check keeps failing must not look healthy: keep why, for the sidebar.
    if (!abortSignal?.aborted) recordPollFailure(options.store, workflowId, err);
  }
  return true;
}
