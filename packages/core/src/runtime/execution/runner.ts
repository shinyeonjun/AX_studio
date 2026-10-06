import type { WorkflowIR } from '../../workflow/schema.js';
import type { ExecutionResult, WorkflowExecutionOptions } from '../types.js';
import {
  type WorkflowExecutionHost,
} from './contracts.js';
import { continueWorkflowAfterApproval } from './approval/resume.js';
import { executeWorkflow } from './execute.js';
import type { ToolResultConfirmation } from '../../contracts/tool-result.js';

export type { WorkflowExecutionHost } from './contracts.js';

export class WorkflowExecutionRunner {
  constructor(private readonly host: WorkflowExecutionHost) {}

  execute(
    ir: WorkflowIR,
    options: WorkflowExecutionOptions = {},
  ): Promise<ExecutionResult> {
    return executeWorkflow(this.host, ir, options);
  }

  continueAfterApproval(
    approvalId: string,
    confirmation?: ToolResultConfirmation,
    abortSignal?: AbortSignal,
  ): Promise<ExecutionResult> {
    return continueWorkflowAfterApproval(this.host, approvalId, confirmation, abortSignal);
  }
}
