const activeChats = new Map<string, AbortController>();

export function registerWorkspaceChat(requestId: string): AbortController {
  const existing = activeChats.get(requestId);
  if (existing) existing.abort();

  const controller = new AbortController();
  activeChats.set(requestId, controller);
  return controller;
}

export function releaseWorkspaceChat(requestId: string): void {
  activeChats.delete(requestId);
}

export function cancelWorkspaceChat(requestId: string): boolean {
  const controller = activeChats.get(requestId);
  if (!controller) return false;
  controller.abort();
  activeChats.delete(requestId);
  return true;
}
