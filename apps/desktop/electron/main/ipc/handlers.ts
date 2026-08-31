import { registerAiHandlers } from './ai-handlers.js';
import { registerConnectionHandlers } from './connection-handlers.js';
import { registerWorkspaceChatHandlers } from './workspace-chat-handlers.js';
import { registerRuntimeHandlers } from './runtime-handlers.js';
import { registerStateHandlers } from './state-handlers.js';
import { registerUtilityHandlers } from './utility-handlers.js';
import { registerDiscoveryHandlers } from './discovery-handlers.js';
import { registerArtifactHandlers } from './artifact-handlers.js';

export function registerIpcHandlers() {
  registerStateHandlers();
  registerWorkspaceChatHandlers();
  registerRuntimeHandlers();
  registerAiHandlers();
  registerConnectionHandlers();
  registerUtilityHandlers();
  registerDiscoveryHandlers();
  registerArtifactHandlers();
}
