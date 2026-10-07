import type { WorkflowIR, Step } from '../workflow/schema.js';
import { requiresApproval } from '../workflow/approval.js';
import type { Connector, ConnectorContext } from '../connectors/types.js';
import type { WorkflowStore } from '../persistence/workflow-store.js';
import type { InvestigationRunner } from '../intelligence/agent/investigation-runner.js';
import type { DecisionEngine } from '../contracts/decision.js';
import { runAiDecision, evaluateCondition } from './ai-investigation.js';
import { resolveStepParams } from './param-resolution.js';
import { resolveDocumentIngestExecution } from '../contracts/document-ingest-resolve.js';
import { applyStepBindings } from '../workflow/bindings.js';
import { actionRefFor, resolveActionDefinition, validateActionParams } from '../workflow/action-definition.js';
import { resolveEffectiveSideEffect } from '../workflow/side-effect-resolve.js';
import { materializeStepOutputs } from './output-ports.js';
import { approvalParamsHash, matchesApprovedSnapshot, redactedApprovalSnapshot, type ApprovedActionSnapshots } from './approval-snapshot.js';
import { messageTool, messageToolDraft } from '../contracts/tool-result.js';
import { connectorErrorMessage } from '../contracts/error-messages.js';
import { assertWorkflowOutputBoundaries, presentationDerivedSteps } from '../workflow/contract-validation/structure/references-validation.js';

export function resolveActionParamsForExecution(
  step: Extract<Step, { type: 'action' }>,
  ir: WorkflowIR,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
): { actionRef: string; actionDefinition: NonNullable<ReturnType<typeof resolveActionDefinition>>; params: Record<string, unknown> } {
  const actionRef = step.actionRef ?? actionRefFor(step.connector, step.action);
  const actionDefinition = resolveActionDefinition(actionRef);
  if (!actionDefinition) {
    throw Object.assign(new Error(`Unknown action definition: ${actionRef}`), { code: 'unknown_action' });
  }
  assertWorkflowOutputBoundaries(ir, ctx.presentationVariableSources);
  // Interpret templates authored in the workflow once. Bound content is opaque
  // data and must never become a second round of workflow instructions. Literal
  // params (structured DSL such as a transform expression) are not templates at all.
  const literalNames = new Set(actionDefinition.params.filter((param) => param.literal).map((param) => param.name));
  const literals = Object.fromEntries(Object.entries(step.params).filter(([name]) => literalNames.has(name)));
  const templated = Object.fromEntries(Object.entries(step.params).filter(([name]) => !literalNames.has(name)));
  let params = { ...resolveStepParams(templated, ctx, stepResults), ...literals };
  params = applyStepBindings(step, ir, params, stepResults, ctx.variables, ctx.outputs);
  if (actionDefinition.id === 'document.ingest') {
    const resolved = resolveDocumentIngestExecution(params, ctx);
    if (!resolved.ok) {
      throw Object.assign(new Error(connectorErrorMessage(resolved.error)), { code: resolved.errorCode ?? 'document_input_required' });
    }
    params = resolved.params;
  }
  return { actionRef, actionDefinition, params };
}

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
  decisionEngine?: DecisionEngine,
  /** The exact params each approved action was approved with (always given when resuming). */
  approvalSnapshots?: ApprovedActionSnapshots,
): Promise<void> {
  assertWorkflowOutputBoundaries(ir, ctx.presentationVariableSources);
  switch (step.type) {
    case 'action':
      {
      const { actionDefinition, params } = resolveActionParamsForExecution(step, ir, ctx, stepResults);

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
      // An approval covers the content that was shown. If the params changed since (a later step
      // wrote the message, a binding resolved differently), ask again with what will really run.
      const approved = approvedActionIds.has(step.id)
        && matchesApprovedSnapshot(approvalSnapshots, step.id, actionDefinition.id, params);
      if ((requiresApproval(effectiveSideEffect, ir.allowExternalAuto) || approvedActionIds.has(step.id)) && !approved) {
        const approvalId = store.createApproval({
          executionId: ctx.executionId,
          actionIds: [step.id],
          reason: approvedActionIds.has(step.id)
            ? `승인 후 보낼 내용이 달라져 다시 확인이 필요합니다: ${actionDefinition.id}`
            : `외부 작업 승인 필요: ${actionDefinition.id}`,
          payload: {
            actionSnapshots: [{
              actionId: step.id,
              actionRef: actionDefinition.id,
              ...redactedApprovalSnapshot(params),
              paramsHash: approvalParamsHash(params),
            }],
          },
        });
        const err = new Error('Approval required') as Error & { code?: string; approvalId?: string; pending?: boolean };
        err.code = 'pending_approval';
        err.approvalId = approvalId;
        err.pending = true;
        throw err;
      }

      if (messageTool(actionDefinition.id) && !messageToolDraft(actionDefinition.id, params)) {
        throw Object.assign(new Error('Unsupported message delivery fields'), { code: 'unsupported_message_fields' });
      }
      const presentation = presentationDerivedSteps(ir, ctx.presentationVariableSources).has(step.id);
      const previousVariables = presentation || ctx.presentationVariableSources
        ? structuredClone(ctx.variables) : undefined;
      const result = await connector.execute(actionDefinition.action, params, ctx);
      if (presentation || ctx.presentationVariableSources) {
        ctx.presentationVariableSources ??= {};
        for (const key of new Set([...Object.keys(previousVariables ?? {}), ...Object.keys(ctx.variables)])) {
          if (JSON.stringify(previousVariables?.[key]) === JSON.stringify(ctx.variables[key])) continue;
          if (presentation && Object.hasOwn(ctx.variables, key)) ctx.presentationVariableSources[key] = step.id;
          else delete ctx.presentationVariableSources[key];
        }
      }
      if (!result.ok) throw Object.assign(new Error(connectorErrorMessage(result.error)), { code: result.errorCode ?? 'action_failed' });
      if (actionDefinition.io?.outputs) {
        ctx.outputs ??= {};
        ctx.outputs[step.id] = materializeStepOutputs(step.id, actionDefinition.io.outputs, result.data);
      }
      stepResults[step.id] = result.data;
      break;
      }

    case 'ai_decision':
      await runAiDecision(step, ir, ctx, stepResults, investigationRunner, connectors, decisionEngine);
      break;

    case 'if': {
      const cond = evaluateCondition(step.condition, ctx.variables, stepResults, ctx.outputs);
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
        payload: {
          stepId: step.id,
          type: 'human_approval',
          actionSnapshots: (pendingActionIds.length > 0 ? pendingActionIds : step.forActionIds).map((actionId) => {
            const action = ir.steps.find((candidate): candidate is Extract<Step, { type: 'action' }> => candidate.type === 'action' && candidate.id === actionId);
            if (!action) return { actionId };
            let resolved: ReturnType<typeof resolveActionParamsForExecution>;
            try {
              resolved = resolveActionParamsForExecution(action, ir, ctx, stepResults);
            } catch (error) {
              // Content made by later steps is not known yet; with no snapshot, the action asks
              // for confirmation again with its real content when it is reached.
              if ((error as { code?: unknown }).code === 'unresolved_binding') return { actionId };
              throw error;
            }
            return {
              actionId,
              actionRef: resolved.actionDefinition.id,
              ...redactedApprovalSnapshot(resolved.params),
              paramsHash: approvalParamsHash(resolved.params),
            };
          }),
        },
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
