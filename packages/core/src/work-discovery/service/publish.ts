import { buildDiscoveryBlueprint, canPublish } from '../compile/blueprint.js';
import { compileBlueprintToWorkflow } from '../compile/compile-workflow.js';
import type { DiscoveryRevisionConflict } from './contracts.js';
import type { DiscoverySessionState } from '../schema.js';
import type { WorkDiscoveryRuntime } from './contracts.js';
import { revisionConflict } from './commands.js';
import { isDiscoveryRevisionConflict } from './lifecycle/runner.js';
import { decodeScheduleInputValue } from '../../workflow/schedule/input-value.js';

function resolveDefaultSourcePath(
  blueprint: NonNullable<DiscoverySessionState['blueprint']>,
): string | undefined {
  const source = blueprint.sources.find((entry) => entry.connector === 'input_artifact');
  const storedPath = source?.metadata?.storedPath;
  return typeof storedPath === 'string' ? storedPath : undefined;
}

export function publishDiscovery(
  runtime: WorkDiscoveryRuntime,
  sessionId: string,
  name?: string,
  expectedRevision?: number,
  /** The schedule the person picked when handing the work over; the work then repeats on it. */
  schedule?: string,
): { workflowId: string } | DiscoveryRevisionConflict | { error: string } {
  const state = runtime.store.getDiscoverySessionState(sessionId);
  if (!state) return { error: 'discovery_not_found' };
  if (expectedRevision !== undefined && state.revision !== expectedRevision) {
    return { error: 'discovery_revision_conflict', currentRevision: state.revision };
  }
  if (state.status === 'published' && state.publishedWorkflowId) {
    return { workflowId: state.publishedWorkflowId };
  }
  const recurrence = schedule === undefined ? undefined : decodeScheduleInputValue(schedule);
  if (schedule !== undefined && !recurrence) return { error: 'invalid_schedule' };
  const gate = canPublish(state);
  if (!gate.ok) return { error: gate.reason };
  const blueprint = state.blueprint ?? buildDiscoveryBlueprint(state);
  if (!blueprint) return { error: 'blueprint_missing' };
  const defaultSourcePath = resolveDefaultSourcePath(blueprint);
  const compiled = compileBlueprintToWorkflow(blueprint, { name, defaultSourcePath });
  const workflow = {
    ...compiled,
    ...(recurrence ? { trigger: { type: 'schedule' as const, recurrence, timezone: recurrence.timezone } } : {}),
    id: 'discovery_' + state.id,
  };
  const saved = runtime.store.getWorkflow(workflow.id)
    ? { workflowId: workflow.id }
    : runtime.store.saveWorkflow(workflow);
  const readRevision = state.revision;
  state.status = 'published';
  state.publishedWorkflowId = saved.workflowId;
  state.revision += 1;
  state.updatedAt = new Date().toISOString();
  try {
    runtime.store.saveDiscoverySession(state, readRevision);
  } catch (error) {
    if (!isDiscoveryRevisionConflict(error)) throw error;
    // The workflow save is idempotent (fixed id); a retry with the fresh revision finishes publish.
    return revisionConflict(runtime, sessionId);
  }
  return { workflowId: saved.workflowId };
}
