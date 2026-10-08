import { buildWorkflowView, summarizeWorkflow } from '@ax-studio/core';
import { ipcHandle } from './ipc-handle.js';
import { getCore } from '../core-instance.js';

export function registerWorkspaceWorkflowHandlers() {
  ipcHandle('ax:loadWorkChat', async (_event, workflowId: string, options?: { optional?: boolean }) => {
    const core = getCore();
    if (typeof workflowId !== 'string' || !workflowId.trim()) throw new Error('업무를 찾을 수 없어요. 화면을 새로고침해 주세요.');
    const normalizedWorkflowId = workflowId.trim();
    const ir = core.store.getWorkflow(normalizedWorkflowId);
    // A chat may still name a work deleted before chats were unlinked from deleted works.
    if (!ir && options?.optional === true) return null;
    if (!ir) throw new Error('업무를 찾을 수 없어요. 이미 삭제됐을 수 있어요.');
    const state = buildWorkflowView(ir, normalizedWorkflowId);
    const active = core.store.listWorkflows().some((entry) => entry.id === normalizedWorkflowId && entry.active);
    return { state, summary: summarizeWorkflow(state.draft), title: ir.name, active };
  });
}
