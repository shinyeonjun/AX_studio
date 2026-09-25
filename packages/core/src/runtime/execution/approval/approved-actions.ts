import type { ConnectorContext } from '../../../connectors/types.js';
import { validateActionParams } from '../../../workflow/action-definition.js';
import type { Step, WorkflowIR } from '../../../workflow/schema.js';
import {
  createContractFailure,
  validateInputSchema,
  validateOutputContract,
} from '../../output-contract.js';
import type { WorkflowExecutionHost } from '../contracts.js';
import { isExternalAction } from '../contracts.js';
import { recordRepairProposal, reportStepProgress } from '../progress.js';
import { materializeStepOutputs } from '../../output-ports.js';
import { approvalParamsHash } from '../../approval-snapshot.js';
import { resolveActionParamsForExecution } from '../../step-executor.js';

export interface ApprovedActionExecutionOptions {
  host: WorkflowExecutionHost;
  ir: WorkflowIR;
  approvedActions: Extract<Step, { type: 'action' }>[];
  remainingStepIds: ReadonlySet<string>;
  ctx: ConnectorContext;
  stepResults: Record<string, unknown>;
  approvalSnapshots: ReadonlyMap<string, { actionRef: string; paramsHash: string }>;
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
      const { actionDefinition, params } = resolveActionParamsForExecution(actionStep, options.ir, options.ctx, options.stepResults);
      const connector = options.host.connectors[actionDefinition.connector];
      if (!connector) {
        throw Object.assign(new Error('Connector not found: ' + actionDefinition.connector), {
          code: 'connector_missing',
        });
      }
      const expected = options.approvalSnapshots.get(actionId);
      if (!expected || expected.actionRef !== actionDefinition.id || expected.paramsHash !== approvalParamsHash(params)) {
        throw Object.assign(new Error('승인 당시의 실행 대상과 현재 실행 대상이 다릅니다.'), {
          code: 'approval_target_changed',
        });
      }
      const missingParams = validateActionParams(actionDefinition, params);
      if (missingParams.length > 0) {
        throw Object.assign(
          new Error(actionDefinition.id + ' 필수 파라미터가 비어 있습니다: ' + missingParams.join(', ')),
          { code: 'action_params_missing' },
        );
      }
      if (options.ir.outputContract && isExternalAction(actionStep, options.ir)) {
        const output = validateOutputContract(options.ir.outputContract, options.ctx.variables, options.stepResults);
        if (!output.ok) throw createContractFailure('output_contract_failed', 'before_external_action', output);
      }
      const result = await connector.execute(
        actionDefinition.action,
        params,
        options.ctx,
      );
      if (!result.ok) {
        throw Object.assign(new Error(result.error ?? 'approved action failed'), { code: result.errorCode });
      }
      if (actionDefinition.io?.outputs) {
        options.ctx.outputs ??= {};
        options.ctx.outputs[actionId] = materializeStepOutputs(actionId, actionDefinition.io.outputs, result.data);
      }
      options.stepResults[actionId] = result.data;
      if (options.ir.outputContract) {
        const input = validateInputSchema(options.ir.outputContract, actionId, result.data);
        if (!input.ok) {
          recordRepairProposal(options.host, options.ir, actionId, result.data);
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
