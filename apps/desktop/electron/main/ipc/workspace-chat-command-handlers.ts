import { registerWorkspaceChatMessageHandler } from './workspace-chat-command-handlers/chat.js';
import { registerWorkspaceChatControlHandlers } from './workspace-chat-command-handlers/controls.js';
import { registerRecurringDraftHandler } from './workspace-chat-command-handlers/recurring.js';

export function registerWorkspaceChatCommandHandlers() {
  registerWorkspaceChatMessageHandler();
  registerWorkspaceChatControlHandlers();
  registerRecurringDraftHandler();
}
