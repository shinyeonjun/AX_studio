import type { WorkspaceChatContext } from './contracts';
import { ipcErrorMessage } from '../../lib/ipc-error';

export function createWorkspaceSourceActions(ctx: WorkspaceChatContext) {
  const refreshWorkspaceSources = async (
    sessionId = ctx.refs.workspaceSessionIdRef.current,
  ) => {
    if (!sessionId) {
      ctx.setWorkspaceSources([]);
      return;
    }
    try {
      const result = await window.ax.listWorkspaceSources(sessionId);
      if (ctx.refs.workspaceSessionIdRef.current === sessionId) {
        ctx.setWorkspaceSources(result.sources);
      }
    } catch (err) {
      ctx.setError(ipcErrorMessage(err, '대화 처리에 실패했습니다.'));
    }
  };

  const attachWorkspaceSource = async () => {
    if (ctx.refs.sourceBusyRef.current || ctx.refs.busyRef.current) return;
    ctx.refs.sourceBusyRef.current = true;
    ctx.setSourceBusy(true);
    ctx.setError('');
    try {
      const result = await window.ax.attachWorkspaceSource(ctx.refs.workspaceSessionIdRef.current);
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
      ctx.onSessionsChanged?.();
    } catch (err) {
      ctx.setError(ipcErrorMessage(err, '대화 처리에 실패했습니다.'));
    } finally {
      ctx.refs.sourceBusyRef.current = false;
      ctx.setSourceBusy(false);
    }
  };

  return {
    refreshWorkspaceSources,
    attachWorkspaceSource,
  };
}
