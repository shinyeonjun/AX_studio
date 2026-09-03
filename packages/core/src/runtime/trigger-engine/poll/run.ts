import { TIME_TRIGGER_TYPES } from '../helpers.js';
import type { TriggerPollerOptions } from './contracts.js';
import { loadTriggerCursors, saveTriggerCursors } from './cursors.js';
import { shouldPollTriggerType } from './eligibility.js';
import { pollTriggerWorkflow } from './workflow.js';

export async function runTriggerPoll(
  options: TriggerPollerOptions,
  generation: number,
): Promise<void> {
  if (!options.store.getGlobalActive()) return;

  const state = {
    cursors: loadTriggerCursors(options.store),
    cursorsChanged: false,
  };

  for (const skill of options.store.listWorkflows()) {
    if (!options.isCurrentGeneration(generation)) return;
    if (!skill.active) continue;

    const workflow = options.store.getWorkflow(skill.id);
    const trigger = workflow?.trigger;
    if (!workflow || !trigger || TIME_TRIGGER_TYPES.has(trigger.type)) continue;
    if (!shouldPollTriggerType(trigger.type, options.pushTransportActive)) continue;

    const shouldContinue = await pollTriggerWorkflow({
      options,
      generation,
      workflowId: skill.id,
      workflow,
      trigger,
      cursor: state.cursors[skill.id] ?? {},
      state,
    });
    if (!shouldContinue) return;
  }

  if (state.cursorsChanged && options.isCurrentGeneration(generation)) {
    saveTriggerCursors(options.store, state.cursors);
  }
}
