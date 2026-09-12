import type { ConnectorContext } from '../../../connectors/types.js';
import type { Step, WorkflowIR } from '../../../workflow/schema.js';
import {
  createContractFailure,
  validateInputSchema,
} from '../../output-contract.js';
import type { WorkflowExecutionHost } from '../contracts.js';
import { recordRepairProposal, reportStepProgress } from '../progress.js';
import { executeAction } from '../action.js';

export interface ApprovedActionExecutionOptions {
  host: WorkflowExecutionHost;
  ir: WorkflowIR;
  approvedActions: Extract<Step, { type: 'action' }>[];
  remainingStepIds: ReadonlySet<string>;
  ctx: ConnectorContext;
  stepResults: Record<string, unknown>;
}

export async function executeApprovedActions(
  options: ApprovedActionExecutionOptions,
): Promise<void> {
  for (const actionStep of options.approvedActions) {
    const actionId = actionStep.id;
    // A branch may have captured the approved action in its remaining sequence.
    // In that case runSequence will execute it exactly once with this approval present.
    if (options.remainingStepIds.has(actionId)) continue;
    reportStepProgress(options.host, options.ctx, actionStep, 'step_started');
    try {
      await executeAction(options.host, actionStep, options.ir, options.ctx, options.stepResults, new Set([actionId]));
      if (options.ir.outputContract) {
        const data = options.stepResults[actionId];
        const input = validateInputSchema(options.ir.outputContract, actionId, data);
        if (!input.ok) {
          recordRepairProposal(options.host, options.ir, actionId, data);
          throw createContractFailure('input_schema_drift', 'after_source_step', input);
        }
      }
      reportStepProgress(options.host, options.ctx, actionStep, 'step_completed');
    } catch (error) {
      reportStepProgress(options.host, options.ctx, actionStep, 'step_failed',
        error instanceof Error ? error.message : String(error));
      throw error;
    }
  }
}
