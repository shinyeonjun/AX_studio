import { registerAiHandlers } from './ai-handlers.js';
import { registerConnectionHandlers } from './connection-handlers.js';
import { registerInterviewHandlers } from './interview-handlers.js';
import { registerRuntimeHandlers } from './runtime-handlers.js';
import { registerStateHandlers } from './state-handlers.js';
import { registerUtilityHandlers } from './utility-handlers.js';

export function registerIpcHandlers() {
  registerStateHandlers();
  registerInterviewHandlers();
  registerRuntimeHandlers();
  registerAiHandlers();
  registerConnectionHandlers();
  registerUtilityHandlers();
}
