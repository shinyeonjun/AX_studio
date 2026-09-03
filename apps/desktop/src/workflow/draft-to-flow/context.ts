import type { WorkflowCanvasDraft } from '@ax-studio/core';
import type { DraftFlowBuildContext, DraftToFlowOptions } from './contracts.js';

export function createDraftFlowContext(
  draft: WorkflowCanvasDraft,
  options: DraftToFlowOptions,
): DraftFlowBuildContext {
  const workflowNodes = draft.nodes ?? [];
  return {
    draft,
    ...options,
    nodes: [],
    edges: [],
    byId: new Map(workflowNodes.map((node) => [node.id, node])),
    enterCounter: 0,
  };
}
