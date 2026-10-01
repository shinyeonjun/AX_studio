import { getTriggerHandler } from '../../../triggers/registry.js';
import { matchesTriggerFilter } from '../../../triggers/filter.js';
import type { TriggerCursor, TriggerPollResult } from '../../../triggers/types.js';
import type { WorkflowIR } from '../../../workflow/schema.js';
import type { ExecutionResult } from '../../types.js';
import {
  cursorAfterEvent,
  eventDedupeKey,
  triggerInputFromEvent,
  triggerRunWasAccepted,
} from '../helpers.js';
import type { TriggerPollerOptions, TriggerPollState } from './contracts.js';
import { saveWorkflowTriggerCursor } from './cursors.js';

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
  if (!options.store.isWorkflowSnapshotCurrent(workflow)) return true;

  try {
    const pollResult = await awaitPollRead(() => handler.poll!({
      workflowId,
      trigger,
      cursor,
      connectors: options.runtime.connectors,
      abortSignal,
    }), abortSignal);
    if (!pollResult || abortSignal?.aborted || !options.isCurrentGeneration(generation)) return false;
    if (!options.store.isWorkflowSnapshotCurrent(workflow)) return true;

    let processedCursor: TriggerCursor = {
      ...cursor,
      initialized: pollResult.cursor.initialized ?? cursor.initialized,
      folderId: pollResult.cursor.folderId ?? cursor.folderId,
      channelId: pollResult.cursor.channelId ?? cursor.channelId,
    };
    for (const event of pollResult.events) {
      if (!options.isCurrentGeneration(generation)) return false;
      if (!options.store.isWorkflowSnapshotCurrent(workflow)) return true;
      const dedupeKey = eventDedupeKey(workflowId, event);
      if (dedupeKey && options.store.isTriggerReceiptCompleted(dedupeKey)) {
        processedCursor = cursorAfterEvent(processedCursor, event);
        state.cursors[workflowId] = processedCursor;
        saveWorkflowTriggerCursor(options.store, workflowId, processedCursor);
        state.changedWorkflows.delete(workflowId);
        continue;
      }

      if (!matchesTriggerFilter(trigger, event)) {
        processedCursor = cursorAfterEvent(processedCursor, event);
        if (dedupeKey) options.rememberEvent(dedupeKey);
        state.cursors[workflowId] = processedCursor;
        saveWorkflowTriggerCursor(options.store, workflowId, processedCursor);
        state.changedWorkflows.delete(workflowId);
        continue;
      }

      if (
        dedupeKey
        && !options.store.claimTriggerReceipt({
          dedupeKey,
          workflowId,
          triggerType: trigger.type,
        })
      ) {
        processedCursor = cursorAfterEvent(processedCursor, event);
        state.cursors[workflowId] = processedCursor;
        saveWorkflowTriggerCursor(options.store, workflowId, processedCursor);
        state.changedWorkflows.delete(workflowId);
        continue;
      }

      let result: unknown;
      try {
        result = await options.runtime.executeWorkflow(workflow, {
          triggerType: trigger.type,
          input: triggerInputFromEvent(event),
        });
      } catch (err) {
        if (!options.store.isWorkflowSnapshotCurrent(workflow)) return true;
        if (dedupeKey) options.store.failTriggerReceipt(dedupeKey);
        throw err;
      }
      if (!options.store.isWorkflowSnapshotCurrent(workflow)) return true;
      if (!triggerRunWasAccepted(result)) {
        if (dedupeKey) options.store.failTriggerReceipt(dedupeKey);
        throw new Error(
          `trigger execution was not accepted: ${(result as Partial<ExecutionResult>).status ?? 'unknown'}`,
        );
      }
      if (dedupeKey) {
        options.store.completeTriggerReceipt(dedupeKey, (result as ExecutionResult).executionId);
      }
      processedCursor = cursorAfterEvent(processedCursor, event);
      if (dedupeKey) options.rememberEvent(dedupeKey);
      state.cursors[workflowId] = processedCursor;
      saveWorkflowTriggerCursor(options.store, workflowId, processedCursor);
      state.changedWorkflows.delete(workflowId);
      if (!options.isCurrentGeneration(generation)) return false;
      options.onTriggeredRun?.(workflowId, result);
    }

    if (JSON.stringify(pollResult.cursor) !== JSON.stringify(processedCursor)) {
      state.cursors[workflowId] = pollResult.cursor;
      state.changedWorkflows.set(workflowId, workflow);
    }
  } catch (err) {
    console.error(`[trigger-engine] poll failed for skill ${workflowId}:`, err);
  }
  return true;
}
