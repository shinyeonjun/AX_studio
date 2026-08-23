import type { WorkflowIR, Step } from '../workflow/schema.js';
import { requiresApproval } from '../workflow/approval.js';
import type { Connector, ConnectorContext } from '../modules/types.js';
import type { WorkflowStore } from '../store/workflow-store.js';
import type { InvestigationRunner } from '../agent/investigation-runner.js';
import { runAiDecision, evaluateCondition } from './ai-investigation.js';
import { resolveStepParams } from './param-resolution.js';
import { resolveDocumentIngestExecution } from '../contracts/document-ingest-resolve.js';
import { applyStepBindings } from '../workflow/bindings.js';
import { actionRefFor, resolveActionDefinition, validateActionParams } from '../workflow/action-definition.js';
import { resolveEffectiveSideEffect } from '../workflow/side-effect-resolve.js';

export async function executeStep(
  step: Step,
  ir: WorkflowIR,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
  store: WorkflowStore,
  connectors: Record<string, Connector>,
  investigationRunner: InvestigationRunner | undefined,
  runSteps: (stepIds: string[]) => Promise<void>,
  approvedActionIds: ReadonlySet<string> = new Set(),
): Promise<void> {
  switch (step.type) {
    case 'action':
      {
      const actionRef = step.actionRef ?? actionRefFor(step.connector, step.action);
      const actionDefinition = resolveActionDefinition(actionRef);
      if (!actionDefinition) {
        throw Object.assign(new Error(`Unknown action definition: ${actionRef}`), { code: 'unknown_action' });
      }
      let params = applyStepBindings(step, ir, step.params, stepResults, ctx.variables);
      params = resolveStepParams(params, ctx, stepResults);

      if (actionDefinition.id === 'document.ingest') {
        const resolved = resolveDocumentIngestExecution(params, ctx);
        if (!resolved.ok) {
          throw Object.assign(new Error(resolved.error), { code: resolved.errorCode ?? 'document_input_required' });
        }
        params = resolved.params;
      }

      const missingParams = validateActionParams(actionDefinition, params);
      if (missingParams.length > 0) {
        throw Object.assign(
          new Error(`${actionDefinition.id} 필수 파라미터가 비어 있습니다: ${missingParams.join(', ')}`),
          { code: 'action_params_missing', data: { actionRef: actionDefinition.id, missingParams } },
        );
      }

      const connector = connectors[actionDefinition.connector];
      if (!connector) {
        throw Object.assign(new Error(`Connector not found: ${actionDefinition.connector}`), { code: 'connector_missing' });
      }

      const stepSideEffect = ir.sideEffects?.[step.id] ?? step.sideEffect;
      const effectiveSideEffect = resolveEffectiveSideEffect(actionDefinition, params, stepSideEffect);
      if (requiresApproval(effectiveSideEffect, ir.allowExternalAuto) && !approvedActionIds.has(step.id)) {
        const approvalId = store.createApproval({
          executionId: ctx.executionId,
          actionIds: [step.id],
          reason: `외부 작업 승인 필요: ${actionDefinition.id}`,
          payload: step.params,
        });
        const err = new Error('Approval required') as Error & { code?: string; approvalId?: string; pending?: boolean };
        err.code = 'pending_approval';
        err.approvalId = approvalId;
        err.pending = true;
        throw err;
      }

      const result = await connector.execute(actionDefinition.action, params, ctx);
      if (!result.ok) throw Object.assign(new Error(result.error ?? 'action failed'), { code: result.errorCode ?? 'action_failed' });
      stepResults[step.id] = result.data;
      break;
      }

    case 'ai_decision':
      await runAiDecision(step, ir, ctx, stepResults, investigationRunner, connectors);
      break;

    case 'if': {
      const cond = evaluateCondition(step.condition, ctx.variables, stepResults);
      const ids = cond ? step.thenStepIds : step.elseStepIds ?? [];
      ctx.log({
        at: new Date().toISOString(),
        level: 'info',
        code: 'if_branch_selected',
        message: `분기 선택: ${step.id}`,
        data: {
          stepId: step.id,
          branch: cond ? 'then' : 'else',
          targetStepIds: ids,
        },
      });
      if (ids.length > 0) await runSteps(ids);
      break;
    }

    case 'human_approval':
      {
      const pendingActionIds = step.forActionIds.filter((actionId) => !approvedActionIds.has(actionId));
      if (step.forActionIds.length > 0 && pendingActionIds.length === 0) break;
      const humanApprovalId = store.createApproval({
        executionId: ctx.executionId,
        actionIds: pendingActionIds.length > 0 ? pendingActionIds : step.forActionIds,
        reason: step.reason,
        payload: { stepId: step.id, type: 'human_approval' },
      });
      const humanErr = new Error('Human approval required') as Error & {
        code?: string;
        approvalId?: string;
        pending?: boolean;
      };
      humanErr.code = 'pending_approval';
      humanErr.approvalId = humanApprovalId;
      humanErr.pending = true;
      throw humanErr;
      }
  }
}
