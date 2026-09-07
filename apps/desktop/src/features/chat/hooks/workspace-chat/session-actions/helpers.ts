import type { WorkspaceChatContext } from '../contracts';

export function invalidateSession(ctx: WorkspaceChatContext): void {
  ctx.refs.sessionEpochRef.current += 1;
}

export function detachActiveRequest(ctx: WorkspaceChatContext): void {
  ctx.refs.activeRequestIdRef.current = undefined;
  ctx.refs.busyRef.current = false;
  ctx.setBusy(false);
  ctx.setProgress('');
}
