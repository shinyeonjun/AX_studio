import { buildDiscoveryBlueprint, canPublish } from '../compile/blueprint.js';
import { compileBlueprintToWorkflow } from '../compile/compile-workflow.js';
import type { DiscoveryRevisionConflict } from './contracts.js';
import type { DiscoverySessionState } from '../schema.js';
import type { WorkDiscoveryRuntime } from './contracts.js';

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
): { workflowId: string } | DiscoveryRevisionConflict | { error: string } {
  const state = runtime.store.getDiscoverySessionState(sessionId);
  if (!state) return { error: 'discovery_not_found' };
  if (expectedRevision !== undefined && state.revision !== expectedRevision) {
    return { error: 'discovery_revision_conflict', currentRevision: state.revision };
  }
  if (state.status === 'published' && state.publishedWorkflowId) {
    return { workflowId: state.publishedWorkflowId };
  }
  const gate = canPublish(state);
  if (!gate.ok) return { error: gate.reason };
  const blueprint = state.blueprint ?? buildDiscoveryBlueprint(state);
  if (!blueprint) return { error: 'blueprint_missing' };
  const defaultSourcePath = resolveDefaultSourcePath(blueprint);
  const workflow = {
    ...compileBlueprintToWorkflow(blueprint, { name, defaultSourcePath }),
    id: 'discovery_' + state.id,
  };
  const saved = runtime.store.getWorkflow(workflow.id)
    ? { workflowId: workflow.id }
    : runtime.store.saveWorkflow(workflow);
  state.status = 'published';
  state.publishedWorkflowId = saved.workflowId;
  state.revision += 1;
  state.updatedAt = new Date().toISOString();
  runtime.store.saveDiscoverySession(state);
  return { workflowId: saved.workflowId };
}
