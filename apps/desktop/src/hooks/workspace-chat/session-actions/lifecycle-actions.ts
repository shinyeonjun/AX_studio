import type { WorkspaceChatContext } from '../contracts';
import { detachActiveRequest, invalidateSession } from './helpers';

export function createWorkspaceLifecycleActions(ctx: WorkspaceChatContext) {
  const reset = () => {
    ctx.setWorkspaceContextKey((current) => current + 1);
    detachActiveRequest(ctx);
    invalidateSession(ctx);
    ctx.refs.workspaceSessionIdRef.current = undefined;
    ctx.setWorkspaceSessionId(undefined);
    ctx.setWorkspaceWorkflowState(null);
    ctx.setChatMessages([]);
    ctx.setBusy(false);
    ctx.setError('');
    ctx.setProgress('');
    ctx.setEditHint(null);
    ctx.setWorkflowRegistered(false);
    ctx.setWorkspaceSources([]);
    ctx.setSourceBusy(false);
    ctx.refs.sourceBusyRef.current = false;
    ctx.refs.pendingWorkspaceChatRefreshRef.current = undefined;
  };

  const startNewChat = () => {
    reset();
  };

  return { reset, startNewChat };
}
