import type { ConnectorContext } from '../../modules/types.js';
import type { Step, WorkflowIR } from '../../workflow/schema.js';
import { executeStep } from '../step-executor.js';
import { stepsById } from '../control-flow.js';
import {
  createContractFailure,
  validateInputSchema,
  validateOutputContract,
} from '../output-contract.js';
import type { WorkflowExecutionHost, PendingError } from './contracts.js';
import {
  isExternalAction,
} from './contracts.js';
import { recordRepairProposal, reportStepProgress } from './progress.js';

export async function runSequence(
  host: WorkflowExecutionHost,
  sequence: Step[],
  ir: WorkflowIR,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
  afterSequenceStepIds: string[] = [],
  approvedActionIds: ReadonlySet<string> = new Set(),
  executeAfterSequence = true,
): Promise<void> {
  for (let index = 0; index < sequence.length; index++) {
    const step = sequence[index];
    try {
      reportStepProgress(host, ctx, step, 'step_started');
      if (ir.outputContract && isExternalAction(step, ir)) {
        const output = validateOutputContract(ir.outputContract, ctx.variables, stepResults);
        if (!output.ok) throw createContractFailure('output_contract_failed', 'before_external_action', output);
      }
      await executeStep(
        step,
        ir,
        ctx,
        stepResults,
        host.config.store,
        host.connectors,
        host.config.investigationRunner,
        (ids) =>
          runSequence(
            host,
            stepsById(ir.steps, ids),
            ir,
            ctx,
            stepResults,
            sequence.slice(index + 1).map((item) => item.id),
            approvedActionIds,
            false,
          ),
        approvedActionIds,
      );
      if (ir.outputContract && step.type === 'action') {
        const input = validateInputSchema(ir.outputContract, step.id, stepResults[step.id]);
        if (!input.ok) {
          recordRepairProposal(host, ir, step.id, stepResults[step.id]);
          throw createContractFailure('input_schema_drift', 'after_source_step', input);
        }
      }
      reportStepProgress(host, ctx, step, 'step_completed');
    } catch (err) {
      const error = err as PendingError;
      reportStepProgress(
        host,
        ctx,
        step,
        error.pending ? 'waiting_approval' : 'step_failed',
        error.pending ? '승인을 기다리고 있습니다.' : error.message,
      );
      if (error.pending && !error.checkpoint) {
        error.checkpoint = {
          variables: { ...ctx.variables },
          stepResults: { ...stepResults },
          outputs: ctx.outputs ? { ...ctx.outputs } : undefined,
          remainingStepIds: sequence.slice(index + 1).map((item) => item.id),
          pendingOuterStepIds: afterSequenceStepIds,
        };
      } else if (error.pending && error.checkpoint && afterSequenceStepIds.length > 0) {
        error.checkpoint = {
          ...error.checkpoint,
          pendingOuterStepIds: [
            ...(error.checkpoint.pendingOuterStepIds ?? []),
            ...afterSequenceStepIds,
          ],
        };
      }
      throw error;
    }
  }
  // A normal branch returns to its parent loop. The continuation is executed
  // only when resuming from an approval checkpoint, where there is no parent
  // loop left to continue the original sequence.
  if (executeAfterSequence && afterSequenceStepIds.length > 0) {
    await runSequence(
      host,
      stepsById(ir.steps, afterSequenceStepIds),
      ir,
      ctx,
      stepResults,
      [],
      approvedActionIds,
    );
  }
}
