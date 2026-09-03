import { registerWorkspaceChatMessageHandler } from './workspace-chat-command-handlers/chat.js';
import { registerWorkspaceChatControlHandlers } from './workspace-chat-command-handlers/controls.js';

export function registerWorkspaceChatCommandHandlers() {
  registerWorkspaceChatMessageHandler();
  registerWorkspaceChatControlHandlers();
}
