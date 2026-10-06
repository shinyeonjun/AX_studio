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
import { messageTool, messageToolDraft } from '../../../contracts/tool-result.js';
import { withStepDeadline } from '../deadline.js';

export interface ApprovedActionExecutionOptions {
  pinnedConnector?: import('../../../connectors/types.js').Connector;
  onProviderSuccess?: (data: unknown) => void;
  host: WorkflowExecutionHost;
  ir: WorkflowIR;
  approvedActions: Extract<Step, { type: 'action' }>[];
  remainingStepIds: ReadonlySet<string>;
  ctx: ConnectorContext;
  stepResults: Record<string, unknown>;
  approvalSnapshots: ReadonlyMap<string, { actionRef: string; paramsHash: string }>;
  /** Validated by resume only for one final one-shot send, after original binding checks. */
  editedParams?: Record<string, unknown>;
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
      const resolved = resolveActionParamsForExecution(actionStep, options.ir, options.ctx, options.stepResults);
      const actionDefinition = resolved.actionDefinition;
      const params = options.editedParams ?? resolved.params;
      if (messageTool(actionDefinition.id) && !messageToolDraft(actionDefinition.id, params)) {
        throw Object.assign(new Error('Unsupported message delivery fields'), { code: 'unsupported_message_fields' });
      }
      const connector = options.pinnedConnector ?? options.host.connectors[actionDefinition.connector];
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
      const result = await withStepDeadline(options.host, options.ctx, actionId, () => connector.execute(
        actionDefinition.action,
        params,
        options.ctx,
      ));
      if (!result.ok) {
        throw Object.assign(new Error(result.error ?? 'approved action failed'), { code: result.errorCode });
      }
      options.onProviderSuccess?.(result.data);
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
