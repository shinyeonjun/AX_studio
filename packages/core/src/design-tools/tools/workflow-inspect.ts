import type { DesignToolHandler } from '../types.js';

/**
 * Exposes only the current draft snapshot to the authoring agent.
 * It never returns a live WorkflowIR and never invokes a connector.
 */
export const workflowInspect: DesignToolHandler = (ctx) => {
  if (!ctx.workflow) {
    return {
      available: false,
      reason: 'workflow_context_unavailable',
    };
  }

  return {
    available: true,
    revision: ctx.workflow.revision,
    draft: ctx.workflow.draft,
    completeness: ctx.workflow.completeness,
  };
};
