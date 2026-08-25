import { buildWorkflowView, summarizeWorkflow } from '@ax-studio/core';
import { ipcHandle } from './ipc-handle.js';
import { getCore } from '../core-instance.js';

export function registerWorkspaceWorkflowHandlers() {
  ipcHandle('ax:loadWorkChat', async (_event, workflowId: string) => {
    const core = getCore();
    if (typeof workflowId !== 'string' || !workflowId.trim()) throw new Error('Workflow id가 필요합니다.');
    const normalizedWorkflowId = workflowId.trim();
    const ir = core.store.getWorkflow(normalizedWorkflowId);
    if (!ir) throw new Error('Workflow not found');
    const state = buildWorkflowView(ir, normalizedWorkflowId);
    const active = core.store.listWorkflows().some((entry) => entry.id === normalizedWorkflowId && entry.active);
    return { state, summary: summarizeWorkflow(state.draft), title: ir.name, active };
  });
}
