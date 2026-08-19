import type { WorkflowIR, Step } from '../workflow/schema.js';
import { requiresApproval } from '../workflow/approval.js';
import type { Connector, ConnectorContext } from '../modules/types.js';
import type { WorkflowStore } from '../store/workflow-store.js';
import type { AgentHarness } from '../agent/harness.js';
import { runAiDecision, resolveStepParams, evaluateCondition } from './ai-investigation.js';
import { resolveDocumentIngestParams } from '../contracts/mappers.js';
import type { FileRef } from '../contracts/artifacts/file-ref.js';
import { applyStepBindings } from '../workflow/bindings.js';
import { resolveIngestPath } from './source-resolver.js';

function hasHumanApprovalForAction(ir: WorkflowIR, actionId: string): boolean {
  return ir.steps.some(
    (step) => step.type === 'human_approval' && step.forActionIds.includes(actionId),
  );
}

function resolveDocumentIngestPath(
  params: Record<string, unknown>,
  ctx: ConnectorContext,
): { ok: true; params: Record<string, unknown> } | { ok: false; error: string; errorCode: string } {
  const withInput = resolveDocumentIngestParams(params, ctx.variables);
  const file = withInput.file as FileRef | undefined;
  const path = typeof withInput.path === 'string' ? withInput.path : undefined;

  if (ctx.resolveFileRef && file) {
    const resolved = ctx.resolveFileRef(file);
    if (!resolved.ok) {
      return {
        ok: false,
        error: resolved.error ?? 'source_resolve_failed',
        errorCode: resolved.errorCode ?? 'source_resolve_failed',
      };
    }
    return { ok: true, params: { ...withInput, path: resolved.path, file: resolved.file ?? file } };
  }

  if (path && ctx.connections?.length) {
    const resolved = resolveIngestPath({ path, file }, ctx.connections);
    if (!resolved.ok) {
      return { ok: false, error: resolved.error, errorCode: resolved.errorCode };
    }
    return { ok: true, params: { ...withInput, path: resolved.path, file: resolved.file } };
  }

  if (!path && !file) {
    return { ok: false, error: '문서 입력이 비어 있습니다.', errorCode: 'document_input_required' };
  }

  return { ok: true, params: withInput };
}

export async function executeStep(
  step: Step,
  ir: WorkflowIR,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
  store: WorkflowStore,
  connectors: Record<string, Connector>,
  agentHarness: AgentHarness | undefined,
  runSteps: (stepIds: string[]) => Promise<void>,
): Promise<void> {
  switch (step.type) {
    case 'action':
      if (
        requiresApproval(step.sideEffect, ir.allowExternalAuto) &&
        !hasHumanApprovalForAction(ir, step.id)
      ) {
        const approvalId = store.createApproval({
          executionId: ctx.executionId,
          actionIds: [step.id],
          reason: `외부 작업 승인 필요: ${step.connector}.${step.action}`,
          payload: step.params,
        });
        const err = new Error('Approval required') as Error & { code?: string; approvalId?: string; pending?: boolean };
        err.code = 'pending_approval';
        err.approvalId = approvalId;
        err.pending = true;
        throw err;
      }
      const connector = connectors[step.connector];
      if (!connector) throw Object.assign(new Error(`Connector not found: ${step.connector}`), { code: 'connector_missing' });

      let params = resolveStepParams(step.params, ctx, stepResults);
      params = applyStepBindings(step, ir, params, stepResults, ctx.variables);

      if (step.connector === 'document' && step.action === 'ingest') {
        const resolved = resolveDocumentIngestPath(params, ctx);
        if (!resolved.ok) {
          throw Object.assign(new Error(resolved.error), { code: resolved.errorCode ?? 'document_input_required' });
        }
        params = resolved.params;
      }

      const result = await connector.execute(step.action, params, ctx);
      if (!result.ok) throw Object.assign(new Error(result.error ?? 'action failed'), { code: result.errorCode ?? 'action_failed' });
      stepResults[step.id] = result.data;
      break;

    case 'ai_decision':
      await runAiDecision(step, ir, ctx, stepResults, agentHarness, connectors);
      break;

    case 'if': {
      const cond = evaluateCondition(step.condition, ctx.variables, stepResults);
      const ids = cond ? step.thenStepIds : step.elseStepIds ?? [];
      if (ids.length > 0) await runSteps(ids);
      break;
    }

    case 'human_approval':
      const humanApprovalId = store.createApproval({
        executionId: ctx.executionId,
        actionIds: step.forActionIds,
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
