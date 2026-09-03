import type { ConnectorContext } from '../../../modules/types.js';
import { resolveDocumentIngestExecution } from '../../../contracts/document-ingest-resolve.js';
import { applyStepBindings } from '../../../workflow/bindings.js';
import { actionRefFor, resolveActionDefinition, validateActionParams } from '../../../workflow/action-definition.js';
import type { Step, WorkflowIR } from '../../../workflow/schema.js';
import {
  createContractFailure,
  validateInputSchema,
  validateOutputContract,
} from '../../output-contract.js';
import { resolveStepParams } from '../../param-resolution.js';
import type { WorkflowExecutionHost } from '../contracts.js';
import { isExternalAction } from '../contracts.js';
import { recordRepairProposal } from '../progress.js';

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
    const actionRef = actionStep.actionRef ?? actionRefFor(actionStep.connector, actionStep.action);
    const actionDefinition = resolveActionDefinition(actionRef);
    if (!actionDefinition) {
      throw Object.assign(new Error('Unknown action definition: ' + actionRef), { code: 'unknown_action' });
    }
    const connector = options.host.connectors[actionDefinition.connector];
    if (!connector) {
      throw Object.assign(new Error('Connector not found: ' + actionDefinition.connector), {
        code: 'connector_missing',
      });
    }
    let params = applyStepBindings(actionStep, options.ir, actionStep.params, options.stepResults, options.ctx.variables);
    params = resolveStepParams(params, options.ctx, options.stepResults);
    if (actionDefinition.id === 'document.ingest') {
      const resolved = resolveDocumentIngestExecution(params, options.ctx);
      if (!resolved.ok) {
        throw Object.assign(new Error(resolved.error), { code: resolved.errorCode ?? 'document_input_required' });
      }
      params = resolved.params;
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
    options.stepResults[actionId] = result.data;
    if (options.ir.outputContract) {
      const input = validateInputSchema(options.ir.outputContract, actionId, result.data);
      if (!input.ok) {
        recordRepairProposal(options.host, options.ir, actionId, result.data);
        throw createContractFailure('input_schema_drift', 'after_source_step', input);
      }
    }
  }
}
