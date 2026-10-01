import { TIME_TRIGGER_TYPES } from '../helpers.js';
import type { TriggerPollerOptions } from './contracts.js';
import { loadTriggerCursors, saveTriggerCursors } from './cursors.js';
import { shouldPollTriggerType } from './eligibility.js';
import { pollTriggerWorkflow } from './workflow.js';
import type { TriggerPollState } from './contracts.js';

export async function runTriggerPoll(
  options: TriggerPollerOptions,
  generation: number,
  abortSignal?: AbortSignal,
): Promise<void> {
  if (!options.store.getGlobalActive()) return;

  const state: TriggerPollState = {
    cursors: loadTriggerCursors(options.store),
    changedWorkflows: new Map(),
  };

  for (const { id: workflowId, workflow } of options.store.listActiveWorkflowDefinitions()) {
    if (!options.isCurrentGeneration(generation)) return;
    const trigger = workflow?.trigger;
    if (!workflow || !trigger || TIME_TRIGGER_TYPES.has(trigger.type)) continue;
    if (!shouldPollTriggerType(trigger.type, options.pushTransportActive)) continue;

    const shouldContinue = await pollTriggerWorkflow({
      options,
      generation,
      abortSignal,
      workflowId,
      workflow,
      trigger,
      cursor: state.cursors[workflowId] ?? {},
      state,
    });
    if (!shouldContinue) return;
  }

  if (state.changedWorkflows.size > 0 && options.isCurrentGeneration(generation)) {
    const cursors = loadTriggerCursors(options.store);
    let changed = false;
    for (const [workflowId, workflow] of state.changedWorkflows) {
      if (!options.store.isWorkflowSnapshotCurrent(workflow)) continue;
      cursors[workflowId] = state.cursors[workflowId]!;
      changed = true;
    }
    if (changed) saveTriggerCursors(options.store, cursors);
  }
}
