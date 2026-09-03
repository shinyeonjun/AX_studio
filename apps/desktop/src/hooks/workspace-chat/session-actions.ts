import type { WorkspaceChatContext } from './contracts';
import { createWorkspaceLifecycleActions } from './session-actions/lifecycle-actions';
import { createWorkspaceLoadActions } from './session-actions/load-actions';

export function createWorkspaceSessionActions(ctx: WorkspaceChatContext) {
  const lifecycle = createWorkspaceLifecycleActions(ctx);
  const loading = createWorkspaceLoadActions(ctx);

  return {
    refreshMappedWorkspaceChat: loading.refreshMappedWorkspaceChat,
    reset: lifecycle.reset,
    startNewChat: lifecycle.startNewChat,
    loadWorkspaceChat: loading.loadWorkspaceChat,
    openWorkChat: loading.openWorkChat,
  };
}
