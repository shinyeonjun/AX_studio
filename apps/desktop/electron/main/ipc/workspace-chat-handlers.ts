import { registerWorkspaceChatCommandHandlers } from './workspace-chat-command-handlers.js';
import { registerWorkspaceChatPersistenceHandlers } from './workspace-chat-persistence-handlers.js';
import { registerWorkspaceWorkflowHandlers } from './workspace-workflow-handlers.js';
import { registerWorkspaceSourceHandlers } from './workspace-source-handlers.js';

/** Register the independent command, persistence, and workflow-view IPC surfaces. */
export function registerWorkspaceChatHandlers() {
  registerWorkspaceChatCommandHandlers();
  registerWorkspaceChatPersistenceHandlers();
  registerWorkspaceWorkflowHandlers();
  registerWorkspaceSourceHandlers();
}
