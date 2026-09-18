import type { WorkspaceChatContext } from './contracts';

export function invalidateSession(ctx: WorkspaceChatContext): void {
  ctx.refs.sessionEpochRef.current += 1;
  ctx.refs.sourceBusyRef.current = false;
  ctx.setSourceBusy(false);
}

export function detachActiveRequest(ctx: WorkspaceChatContext): void {
  const requestId = ctx.refs.activeRequestIdRef.current;
  if (requestId && typeof window !== 'undefined' && typeof window.ax.cancelChat === 'function') {
    void window.ax.cancelChat(requestId).catch(() => undefined);
  }
  ctx.refs.activeRequestIdRef.current = undefined;
  ctx.refs.busyRef.current = false;
  ctx.setBusy(false);
  ctx.setProgress('');
}

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
    ctx.refs.pendingWorkspaceChatRefreshRef.current = undefined;
  };

  return { reset, startNewChat: reset };
}
