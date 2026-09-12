import type { WorkspaceChatContext } from './contracts';
import { ipcErrorMessage } from '../../../../ui/lib/ipc-error';

export function createWorkspaceSourceActions(ctx: WorkspaceChatContext) {
  const refreshWorkspaceSources = async (
    sessionId = ctx.refs.workspaceSessionIdRef.current,
  ) => {
    const epoch = ctx.refs.sessionEpochRef.current;
    if (!sessionId) {
      ctx.setWorkspaceSources([]);
      return;
    }
    try {
      const result = await window.ax.listWorkspaceSources(sessionId);
      if (ctx.isCurrentSession(epoch) && ctx.isViewingSession(sessionId)) {
        ctx.setWorkspaceSources(result.sources);
      }
    } catch (err) {
      if (ctx.isCurrentSession(epoch) && ctx.isViewingSession(sessionId)) {
        ctx.setError(ipcErrorMessage(err, '대화 처리에 실패했습니다.'));
      }
    }
  };

  const attachWorkspaceSource = async () => {
    if (ctx.refs.sourceBusyRef.current || ctx.refs.busyRef.current) return;
    const epoch = ctx.refs.sessionEpochRef.current;
    const sessionId = ctx.refs.workspaceSessionIdRef.current;
    ctx.refs.sourceBusyRef.current = true;
    ctx.setSourceBusy(true);
    ctx.setError('');
    try {
      const result = await window.ax.attachWorkspaceSource(sessionId);
      if (result.ok) ctx.onSessionsChanged?.();
      if (!ctx.isCurrentSession(epoch) || !ctx.isViewingSession(sessionId)) return;
      if (!result.ok) {
        if (result.error) ctx.setError(result.error);
        return;
      }
      ctx.refs.workspaceSessionIdRef.current = result.sessionId;
      ctx.setWorkspaceSessionId(result.sessionId);
      ctx.setWorkspaceSources((current) => [
        ...current.filter((source) => source.id !== result.source.id),
        result.source,
      ]);
      await refreshWorkspaceSources(result.sessionId);
    } catch (err) {
      if (ctx.isCurrentSession(epoch)) ctx.setError(ipcErrorMessage(err, '대화 처리에 실패했습니다.'));
    } finally {
      if (ctx.isCurrentSession(epoch)) {
        ctx.refs.sourceBusyRef.current = false;
        ctx.setSourceBusy(false);
      }
    }
  };

  return {
    refreshWorkspaceSources,
    attachWorkspaceSource,
  };
}
