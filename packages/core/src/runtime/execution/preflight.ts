import type { ExecutionLogEntry } from '../../modules/types.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import type { ExecutionResult, WorkflowExecutionOptions } from '../types.js';
import type { WorkflowExecutionHost } from './contracts.js';

export function recordPreflightResult(
  host: WorkflowExecutionHost,
  options: WorkflowExecutionOptions,
  ir: WorkflowIR | undefined,
  status: 'failed' | 'cancelled',
  errorCode: string,
  message: string,
  data?: unknown,
): ExecutionResult {
  let irJson: string | undefined;
  if (ir) {
    try {
      irJson = JSON.stringify(ir);
    } catch {
      irJson = undefined;
    }
  }
  const executionId = host.config.store.createExecution({
    workflowId: options.ephemeral ? undefined : ir?.id,
    workflowVersion: ir?.version,
    ephemeral: options.ephemeral ?? false,
    triggerType: options.triggerType,
    irJson,
    workspaceSessionId: options.workspaceSessionId,
  });
  host.notifyExecutionStarted(executionId);
  const log: ExecutionLogEntry[] = [{
    at: new Date().toISOString(),
    level: status === 'failed' ? 'error' : 'warn',
    code: errorCode,
    message,
    ...(data === undefined ? {} : { data }),
  }];
  host.config.store.finishExecution(executionId, status, errorCode, log);
  const result: ExecutionResult = { executionId, status, errorCode, log };
  host.notifyExecutionFinished(result);
  return result;
}
