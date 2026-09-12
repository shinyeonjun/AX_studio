import type { WorkspaceChatContext } from './contracts';

function invalidateSession(ctx: WorkspaceChatContext): void {
  ctx.refs.sessionEpochRef.current += 1;
  ctx.refs.sourceBusyRef.current = false;
  ctx.setSourceBusy(false);
}

function detachActiveRequest(ctx: WorkspaceChatContext): void {
  ctx.refs.activeRequestIdRef.current = undefined;
  ctx.refs.busyRef.current = false;
  ctx.setBusy(false);
  ctx.setProgress('');
}

/** Detach the view, not the underlying durable run. Every session switch uses this transition. */
function resetWorkspaceView(ctx: WorkspaceChatContext): void {
  ctx.setWorkspaceContextKey((current) => current + 1);
  detachActiveRequest(ctx);
  invalidateSession(ctx);
  ctx.refs.workspaceSessionIdRef.current = undefined;
  ctx.setWorkspaceSessionId(undefined);
  ctx.setWorkspaceWorkflowState(null);
  ctx.setChatMessages([]);
  ctx.setError('');
  ctx.setEditHint(null);
  ctx.setWorkflowRegistered(false);
  ctx.setWorkspaceSources([]);
  ctx.refs.pendingWorkspaceChatRefreshRef.current = undefined;
  ctx.refs.chatRefreshSequenceRef.current += 1;
}

export function beginSessionLoad(ctx: WorkspaceChatContext): number {
  resetWorkspaceView(ctx);
  ctx.refs.busyRef.current = true;
  ctx.setBusy(true);
  return ctx.refs.sessionEpochRef.current;
}

export function finishSessionLoad(ctx: WorkspaceChatContext, epoch: number): void {
  if (!ctx.isCurrentSession(epoch)) return;
  ctx.refs.busyRef.current = false;
  ctx.setBusy(false);
}

export function createWorkspaceLifecycleActions(ctx: WorkspaceChatContext) {
  const reset = () => resetWorkspaceView(ctx);

  return { reset, startNewChat: reset };
}
