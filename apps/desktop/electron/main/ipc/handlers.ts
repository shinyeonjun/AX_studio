import { registerAiHandlers } from './ai-handlers.js';
import { registerConnectionHandlers } from './connection-handlers.js';
import { registerWorkspaceChatHandlers } from './workspace-chat-handlers.js';
import { registerRuntimeHandlers } from './runtime-handlers.js';
import { registerStateHandlers } from './state-handlers.js';
import { registerDiscoveryHandlers } from './discovery-handlers.js';
import { registerArtifactHandlers } from './artifact-handlers.js';
import { registerDiagnosticsHandlers } from '../diagnostics/ipc.js';
import { registerUpdateHandlers } from '../updates/ipc.js';
import { registerLoginItemHandlers } from '../startup/login-item.js';

export function registerIpcHandlers() {
  registerStateHandlers();
  registerWorkspaceChatHandlers();
  registerRuntimeHandlers();
  registerAiHandlers();
  registerConnectionHandlers();
  registerDiscoveryHandlers();
  registerArtifactHandlers();
  registerDiagnosticsHandlers();
  registerUpdateHandlers();
  registerLoginItemHandlers();
}
