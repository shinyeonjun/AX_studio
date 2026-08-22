import type { WorkflowIR } from '../workflow/schema.js';
import type { WorkflowStore } from '../store/workflow-store.js';
import type { WorkflowRuntime } from './engine.js';
import type { ExecutionResult } from './types.js';
import {
  buildManualRunInput,
  enrichManualRunInput,
  validateManualRunInput,
} from './manual-run-input.js';

export interface ManualWorkflowRunOptions {
  ephemeral: boolean;
  workflowId?: string;
}

export interface ManualWorkflowRunDeps {
  store: WorkflowStore;
  runtime: WorkflowRuntime;
}

function recordManualRunFailure(
  deps: ManualWorkflowRunDeps,
  ir: WorkflowIR,
  options: ManualWorkflowRunOptions,
  errorCode: string,
  message: string,
): ExecutionResult {
  const executionId = deps.store.createExecution({
    workflowId: options.ephemeral ? undefined : options.workflowId ?? ir.id,
    workflowVersion: ir.version,
    ephemeral: options.ephemeral,
    triggerType: 'manual',
    irJson: JSON.stringify(ir),
  });
  const log = [{
    at: new Date().toISOString(),
    level: 'error' as const,
    code: errorCode,
    message,
  }];
  deps.store.finishExecution(executionId, 'failed', errorCode, log);
  return { executionId, status: 'failed', errorCode, log };
}

/** Shared manual-run path for IPC and plain-chat workflows.run. */
export async function runManualWorkflow(
  deps: ManualWorkflowRunDeps,
  ir: WorkflowIR,
  options: ManualWorkflowRunOptions,
): Promise<ExecutionResult> {
  if (!deps.store.getSetting<boolean>('globalActive', true)) {
    return deps.runtime.executeWorkflow(ir, {
      ephemeral: options.ephemeral,
      triggerType: 'manual',
      forceManual: true,
    });
  }

  let input: Record<string, unknown>;
  try {
    input = buildManualRunInput(ir, deps.store);
  } catch (error) {
    return recordManualRunFailure(
      deps,
      ir,
      options,
      (error as { code?: string }).code ?? 'manual_run_input_failed',
      error instanceof Error ? error.message : String(error),
    );
  }

  const enrichedInput = await enrichManualRunInput(ir, deps.runtime.connectors, input);
  const validation = validateManualRunInput(ir, enrichedInput);
  if (!validation.ok) {
    return recordManualRunFailure(deps, ir, options, validation.errorCode, validation.message);
  }

  return deps.runtime.executeWorkflow(ir, {
    ephemeral: options.ephemeral,
    triggerType: 'manual',
    input: enrichedInput,
    forceManual: true,
  });
}

export async function runSavedWorkflowById(
  deps: ManualWorkflowRunDeps,
  workflowId: string,
): Promise<ExecutionResult> {
  const ir = deps.store.getWorkflow(workflowId);
  if (!ir) {
    throw Object.assign(new Error('Workflow not found'), { code: 'workflow_not_found' });
  }
  return runManualWorkflow(deps, ir, { ephemeral: false, workflowId });
}
