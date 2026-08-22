import type { DesignToolHandler } from '../types.js';

export const workflowsList: DesignToolHandler = async (ctx) => {
  if (!ctx.workflowActions) {
    throw Object.assign(new Error('workflows unavailable'), { code: 'workflows_unavailable' });
  }
  const workflows = await ctx.workflowActions.list();
  return { workflows };
};
