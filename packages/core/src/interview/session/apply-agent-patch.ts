import { buildConnectedResourcesFromConnections } from '../resources/connected-resources.js';
import { applySlotValuesToDraft } from '../slots/patch.js';
import { finalizeInterviewDraft } from '../slots/seed.js';
import { normalizeDraftActions } from '../draft/actions.js';
import type { WorkflowNode } from '../draft/schema.js';
import { parseWorkflowDraftPatch, type WorkflowDraftPatch } from '../agent/draft-patch.js';
import { hydrateInterviewState, type InterviewState } from './state.js';
import type { DesignToolContext } from '../../design-tools/types.js';

function upsertNodes(current: WorkflowNode[], additions: WorkflowNode[]): WorkflowNode[] {
  const byId = new Map(current.map((node) => [node.id, node]));
  for (const node of additions) {
    byId.set(node.id, node);
  }
  return [...byId.values()];
}

function removeNodes(
  nodes: WorkflowNode[],
  actions: InterviewState['workflow']['actions'],
  ids: string[],
): { nodes: WorkflowNode[]; actions: InterviewState['workflow']['actions'] } {
  if (ids.length === 0) return { nodes, actions };
  const remove = new Set(ids);
  const nextActions = { ...actions };
  for (const id of remove) delete nextActions[id];
  return {
    nodes: nodes.filter((node) => !remove.has(node.id)),
    actions: nextActions,
  };
}

/**
 * Apply an Agent-authored patch to the session draft only.
 * Catalog, graph, contract, approval, and runtime validation happen later.
 */
export function applyAgentDraftPatch(
  state: InterviewState,
  rawPatch: WorkflowDraftPatch,
  designToolContext: DesignToolContext,
): { state: ReturnType<typeof hydrateInterviewState>; message: string } {
  const hydrated = hydrateInterviewState(state);
  const patch = parseWorkflowDraftPatch({
    ...rawPatch,
    baseRevision: rawPatch.baseRevision ?? hydrated.draftRevision,
  });
  if (patch.baseRevision !== hydrated.draftRevision) {
    throw Object.assign(
      new Error(`workflow_revision_conflict:${hydrated.draftRevision}`),
      { code: 'workflow_revision_conflict', expectedRevision: hydrated.draftRevision },
    );
  }

  const removed = removeNodes(
    hydrated.workflow.nodes.map((node) => ({ ...node })),
    { ...(hydrated.workflow.actions ?? {}) },
    patch.removeNodeIds,
  );

  let workflow = {
    ...hydrated.workflow,
    ...(patch.meta ?? {}),
    nodes: upsertNodes(removed.nodes, patch.upsertNodes),
    actions: removed.actions,
  };
  const slotValues = { ...hydrated.slotValues, ...patch.set };
  workflow = normalizeDraftActions(applySlotValuesToDraft(workflow, slotValues));
  workflow = finalizeInterviewDraft(workflow, buildConnectedResourcesFromConnections(designToolContext.connections));
  if (hydrated.workScope === 'once' && workflow.nodes.length > 0 && !workflow.triggerType) {
    workflow = { ...workflow, triggerType: 'manual' };
  }

  return {
    state: {
      ...hydrated,
      draftRevision: hydrated.draftRevision + 1,
      workflow,
      slotValues,
    },
    message: patch.message.trim(),
  };
}
