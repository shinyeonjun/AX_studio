import { getTriggerHandler } from '../../../triggers/registry.js';
import { matchesTriggerFilter } from '../../../triggers/filter.js';
import type { TriggerCursor } from '../../../triggers/types.js';
import type { WorkflowIR } from '../../../workflow/schema.js';
import type { ExecutionResult } from '../../types.js';
import {
  cursorAfterEvent,
  eventDedupeKey,
  triggerInputFromEvent,
  triggerRunWasAccepted,
} from '../helpers.js';
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
}

export async function pollTriggerWorkflow({
  options,
  generation,
  workflowId,
  workflow,
  trigger,
  cursor,
  state,
}: PollWorkflowParams): Promise<boolean> {
  const handler = getTriggerHandler(trigger.type);
  if (!handler?.poll) return true;

  try {
    const pollResult = await handler.poll({
      workflowId,
      trigger,
      cursor,
      connectors: options.runtime.connectors,
    });
    if (!options.isCurrentGeneration(generation)) return false;

    let processedCursor: TriggerCursor = {
      ...cursor,
      initialized: pollResult.cursor.initialized ?? cursor.initialized,
      folderId: pollResult.cursor.folderId ?? cursor.folderId,
      channelId: pollResult.cursor.channelId ?? cursor.channelId,
    };
    for (const event of pollResult.events) {
      if (!options.isCurrentGeneration(generation)) return false;
      const dedupeKey = eventDedupeKey(workflowId, event);
      if (dedupeKey && options.store.isTriggerReceiptCompleted(dedupeKey)) {
        processedCursor = cursorAfterEvent(processedCursor, event);
        state.cursors[workflowId] = processedCursor;
        saveTriggerCursors(options.store, state.cursors);
        state.cursorsChanged = false;
        continue;
      }

      if (!matchesTriggerFilter(trigger, event)) {
        processedCursor = cursorAfterEvent(processedCursor, event);
        if (dedupeKey) options.rememberEvent(dedupeKey);
        state.cursors[workflowId] = processedCursor;
        saveTriggerCursors(options.store, state.cursors);
        state.cursorsChanged = false;
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
        saveTriggerCursors(options.store, state.cursors);
        state.cursorsChanged = false;
        continue;
      }

      let result: unknown;
      try {
        result = await options.runtime.executeWorkflow(workflow, {
          triggerType: trigger.type,
          input: triggerInputFromEvent(event),
        });
      } catch (err) {
        if (dedupeKey) options.store.failTriggerReceipt(dedupeKey);
        throw err;
      }
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
      saveTriggerCursors(options.store, state.cursors);
      state.cursorsChanged = false;
      if (!options.isCurrentGeneration(generation)) return false;
      options.onTriggeredRun?.(workflowId, result);
    }

    if (JSON.stringify(pollResult.cursor) !== JSON.stringify(processedCursor)) {
      state.cursors[workflowId] = pollResult.cursor;
      state.cursorsChanged = true;
    }
  } catch (err) {
    console.error(`[trigger-engine] poll failed for skill ${workflowId}:`, err);
  }
  return true;
}
