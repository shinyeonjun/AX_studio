import type { DesignToolHandler } from '../types.js';

function stringArg(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

export const workflowsRun: DesignToolHandler = async (ctx, args) => {
  if (!ctx.workflowActions) {
    throw Object.assign(new Error('workflows unavailable'), { code: 'workflows_unavailable' });
  }
  const workflowId = stringArg(args, 'workflowId');
  if (!workflowId) {
    throw Object.assign(new Error('workflow id required'), { code: 'workflow_id_required' });
  }

  const listed = await ctx.workflowActions.list();
  const match = listed.find((row) => row.id === workflowId);
  if (!match) {
    throw Object.assign(new Error('Workflow not found'), { code: 'workflow_not_found' });
  }

  return ctx.workflowActions.run(workflowId);
};
