import type { WorkspaceChatContext } from './contracts';
import { publishWorkspaceTranscript } from './transcript-snapshot';

export function invalidateSession(ctx: WorkspaceChatContext): void {
  ctx.refs.sessionEpochRef.current += 1;
  ctx.refs.sourceBusyRef.current = false;
  ctx.setSourceBusy(false);
}

/**
 * Leaves the screen's request running when another chat is opened: its reply is saved to its own
 * conversation and shown there on return. Deleting that conversation is what cancels it.
 */
export function detachActiveRequest(ctx: WorkspaceChatContext): void {
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
    publishWorkspaceTranscript(ctx, { messages: [] });
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
