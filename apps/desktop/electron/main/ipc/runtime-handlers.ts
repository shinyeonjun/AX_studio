import { registerRuntimeActivationHandlers } from './runtime-handlers/activation.js';
import { registerRuntimeApprovalHandlers } from './runtime-handlers/approval.js';
import { registerRuntimeExecutionHandlers } from './runtime-handlers/execution.js';

export function registerRuntimeHandlers() {
  registerRuntimeApprovalHandlers();
  registerRuntimeExecutionHandlers();
  registerRuntimeActivationHandlers();
}
