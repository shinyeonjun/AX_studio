import { registerAiHandlers } from './ai-handlers.js';
import { registerConnectionHandlers } from './connection-handlers.js';
import { registerCommandHandlers } from './command-handlers.js';
import { registerWorkspaceChatHandlers } from './workspace-chat-handlers.js';
import { registerRuntimeHandlers } from './runtime-handlers.js';
import { registerStateHandlers } from './state-handlers.js';
import { registerUtilityHandlers } from './utility-handlers.js';

export function registerIpcHandlers() {
  registerStateHandlers();
  registerCommandHandlers();
  registerWorkspaceChatHandlers();
  registerRuntimeHandlers();
  registerAiHandlers();
  registerConnectionHandlers();
  registerUtilityHandlers();
}
