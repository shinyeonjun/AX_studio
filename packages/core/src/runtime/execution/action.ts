import type { ConnectorContext } from '../../connectors/types.js';
import { resolveDocumentIngestExecution } from '../../contracts/document-ingest-resolve.js';
import { applyStepBindings } from '../../workflow/bindings.js';
import { actionRefFor, resolveActionDefinition, validateActionParams } from '../../workflow/action-definition.js';
import { requiresApproval } from '../../workflow/approval.js';
import { resolveEffectiveSideEffect } from '../../workflow/side-effect-resolve.js';
import type { Step, WorkflowIR } from '../../workflow/schema.js';
import { createContractFailure, validateOutputContract } from '../output-contract.js';
import { materializeStepOutputs } from '../output-ports.js';
import { resolveStepParams } from '../param-resolution.js';
import type { PendingError, WorkflowExecutionHost } from './contracts.js';
import { recordExternalEffectAttempt } from './external-effect.js';

/** Shared action semantics for initial execution and every approval continuation. */
export async function executeAction(
  host: WorkflowExecutionHost,
  step: Extract<Step, { type: 'action' }>,
  ir: WorkflowIR,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
  approvedActionIds: ReadonlySet<string>,
): Promise<void> {
  const actionRef = step.actionRef ?? actionRefFor(step.connector, step.action);
  const definition = resolveActionDefinition(actionRef);
  if (!definition) throw Object.assign(new Error(`Unknown action definition: ${actionRef}`), { code: 'unknown_action' });
  let params = applyStepBindings(step, ir, step.params, stepResults, ctx.variables, ctx.outputs);
  params = resolveStepParams(params, ctx, stepResults);
  if (definition.id === 'document.ingest') {
    const resolved = resolveDocumentIngestExecution(params, ctx);
    if (!resolved.ok) throw Object.assign(new Error(resolved.error), { code: resolved.errorCode ?? 'document_input_required' });
    params = resolved.params;
  }
  const missingParams = validateActionParams(definition, params);
  if (missingParams.length > 0) {
    throw Object.assign(new Error(`${definition.id} 필수 파라미터가 비어 있습니다: ${missingParams.join(', ')}`), {
      code: 'action_params_missing', data: { actionRef: definition.id, missingParams },
    });
  }
  const connector = host.connectors[definition.connector];
  if (!connector) throw Object.assign(new Error(`Connector not found: ${definition.connector}`), { code: 'connector_missing' });
  const sideEffect = resolveEffectiveSideEffect(definition, params, ir.sideEffects?.[step.id] ?? step.sideEffect);
  if (ir.outputContract && (sideEffect === 'EXTERNAL' || sideEffect === 'EXTERNAL_HIGH')) {
    const output = validateOutputContract(ir.outputContract, ctx.variables, stepResults);
    if (!output.ok) throw createContractFailure('output_contract_failed', 'before_external_action', output);
  }
  if (requiresApproval(sideEffect, ir.allowExternalAuto) && !approvedActionIds.has(step.id)) {
    const approvalId = host.config.store.createApproval({
      executionId: ctx.executionId, actionIds: [step.id],
      reason: `외부 작업 승인 필요: ${definition.id}`, payload: step.params,
    });
    throw Object.assign(new Error('Approval required'), {
      code: 'pending_approval', approvalId, pending: true,
    } satisfies Partial<PendingError>);
  }
  recordExternalEffectAttempt(host.config.store, ctx, step.id, definition.id, sideEffect);
  const result = await connector.execute(definition.action, params, ctx);
  if (!result.ok) throw Object.assign(new Error(result.error ?? 'action failed'), { code: result.errorCode ?? 'action_failed' });
  if (definition.io?.outputs) {
    ctx.outputs ??= {};
    ctx.outputs[step.id] = materializeStepOutputs(step.id, definition.io.outputs, result.data);
  }
  stepResults[step.id] = result.data;
}
