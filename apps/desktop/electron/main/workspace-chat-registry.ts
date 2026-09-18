type ActiveWorkspaceChat = {
  controller: AbortController;
  sessionId?: string;
};

const activeChats = new Map<string, ActiveWorkspaceChat>();

export function registerWorkspaceChat(requestId: string, sessionId?: string): AbortController {
  const existing = activeChats.get(requestId);
  if (existing) existing.controller.abort();

  const controller = new AbortController();
  activeChats.set(requestId, { controller, sessionId });
  return controller;
}

export function releaseWorkspaceChat(requestId: string, controller: AbortController): void {
  if (activeChats.get(requestId)?.controller === controller) activeChats.delete(requestId);
}

export function cancelWorkspaceChat(requestId: string): boolean {
  const active = activeChats.get(requestId);
  if (!active) return false;
  active.controller.abort();
  activeChats.delete(requestId);
  return true;
}

export function cancelWorkspaceChatSession(sessionId: string): number {
  let cancelled = 0;
  for (const [requestId, active] of activeChats) {
    if (active.sessionId !== sessionId) continue;
    active.controller.abort();
    activeChats.delete(requestId);
    cancelled += 1;
  }
  return cancelled;
}

/** Abort every in-flight chat turn. Used on app shutdown so quit is not held by a provider call. */
export function abortAllWorkspaceChats(): void {
  for (const { controller } of activeChats.values()) controller.abort();
  activeChats.clear();
}
