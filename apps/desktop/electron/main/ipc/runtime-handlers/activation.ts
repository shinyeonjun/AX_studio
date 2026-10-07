import { ipcHandle } from '../ipc-handle.js';
import { runSavedWorkflowById } from '@ax-studio/core';
import { getCore } from '../../core-instance.js';
import { notifyStateChanged } from '../../state-broadcast.js';

type DeletionCore = Pick<ReturnType<typeof getCore>, 'store' | 'runtime'>;

function isUnreadableWorkflowError(error: unknown): boolean {
  return (error as { code?: unknown } | null)?.code === 'invalid_workflow_json';
}

/**
 * Deletes a workflow. A workflow whose stored definition cannot be parsed ("손상된 업무")
 * is claimed without reading its version; the repository still refuses while an
 * execution is running or waiting for approval.
 */
export async function deleteWorkflowById(core: DeletionCore, workflowId: unknown): Promise<{ ok: true }> {
  if (typeof workflowId !== 'string' || !workflowId.trim()) throw new Error('Workflow id가 필요합니다.');
  let workflow: ReturnType<DeletionCore['store']['getWorkflow']>;
  try {
    workflow = core.store.getWorkflow(workflowId);
  } catch (error) {
    if (!isUnreadableWorkflowError(error)) throw error;
    workflow = null;
  }
  if (!workflow && !core.store.workflowExists(workflowId)) throw new Error('Workflow not found');
  const claimed = workflow
    ? core.store.claimWorkflowDeletion(workflowId, workflow.version)
    : core.store.claimUnreadableWorkflowDeletion(workflowId);
  if (!claimed) {
    throw Object.assign(new Error('워크플로우 삭제가 이미 진행 중입니다. 잠시 후 다시 시도해 주세요.'), {
      code: 'workflow_deletion_in_progress',
    });
  }
  try {
    await core.runtime.removeWorkflow(workflowId);
    const deleted = core.store.deleteWorkflow(workflowId);
    if (!deleted) throw new Error('Workflow not found');
    return { ok: true };
  } finally {
    core.store.releaseWorkflowDeletion(workflowId);
  }
}

/**
 * Runs a saved workflow now, from the work list. The click is the person's confirmation, the
 * same one the chat's run card asks for; a step that sends anything still waits for approval.
 */
export async function runWorkflowNow(core: Pick<ReturnType<typeof getCore>, 'store' | 'runtime'>, workflowId: unknown) {
  if (typeof workflowId !== 'string' || !workflowId.trim()) throw new Error('업무 id가 필요합니다.');
  const result = await runSavedWorkflowById({ store: core.store, runtime: core.runtime }, workflowId);
  return { executionId: result.executionId, status: result.status, errorCode: result.errorCode };
}

export function registerRuntimeActivationHandlers(): void {
  ipcHandle('ax:runWorkflow', async (_e, workflowId: unknown) => {
    try {
      return await runWorkflowNow(getCore(), workflowId);
    } finally {
      notifyStateChanged();
    }
  });
  ipcHandle('ax:deleteWorkflow', async (_e, workflowId: unknown) => deleteWorkflowById(getCore(), workflowId));
  ipcHandle('ax:setWorkflowActive', async (_e, workflowId: unknown, active: unknown) => {
    const core = getCore();
    if (typeof workflowId !== 'string' || !workflowId.trim()) throw new Error('Workflow id가 필요합니다.');
    if (typeof active !== 'boolean') throw new Error('워크플로우 실행 상태가 올바르지 않습니다.');
    if (!core.store.setWorkflowActive(workflowId, active)) throw new Error('Workflow not found');
    core.runtime.setWorkflowActive(workflowId, active);
    return { ok: true };
  });
}
