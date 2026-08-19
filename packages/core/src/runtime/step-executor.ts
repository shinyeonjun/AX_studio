import type { WorkflowIR, Step } from '../workflow/schema.js';
import { requiresApproval } from '../workflow/approval.js';
import type { Connector, ConnectorContext } from '../modules/types.js';
import type { WorkflowStore } from '../store/workflow-store.js';
import type { AgentHarness } from '../agent/harness.js';
import { runAiDecision, resolveStepParams, evaluateCondition } from './ai-investigation.js';
import { resolveDocumentIngestParams } from '../contracts/mappers.js';

function hasHumanApprovalForAction(ir: WorkflowIR, actionId: string): boolean {
  return ir.steps.some(
    (step) => step.type === 'human_approval' && step.forActionIds.includes(actionId),
  );
}

function latestTableFromResults(stepResults: Record<string, unknown>): unknown {
  for (const value of Object.values(stepResults).reverse()) {
    if (Array.isArray(value) && value.length > 0) return value;
  }
  return undefined;
}

function latestDocumentFromResults(stepResults: Record<string, unknown>): unknown {
  for (const value of Object.values(stepResults).reverse()) {
    if (value && typeof value === 'object' && ('pages' in value || 'text' in value || 'artifactPath' in value)) {
      return value;
    }
  }
  return undefined;
}

function resolveTransformParams(
  action: string,
  params: Record<string, unknown>,
  stepResults: Record<string, unknown>,
  ctx: ConnectorContext,
): Record<string, unknown> {
  if (action === 'table_to_text') {
    return {
      ...params,
      table: params.table ?? ctx.variables.sheetData ?? ctx.variables.queryResult ?? latestTableFromResults(stepResults),
    };
  }
  if (action === 'document_to_text') {
    return {
      ...params,
      document: params.document ?? latestDocumentFromResults(stepResults),
    };
  }
  return params;
}

function latestTextFromResults(stepResults: Record<string, unknown>): string | undefined {
  for (const value of Object.values(stepResults).reverse()) {
    if (typeof value === 'string' && value.trim()) return value;
    if (!value || typeof value !== 'object') continue;
    const record = value as Record<string, unknown>;
    for (const key of ['text', 'body', 'conclusion']) {
      const candidate = record[key];
      if (typeof candidate === 'string' && candidate.trim()) return candidate;
    }
  }
  return undefined;
}

function enrichMessagingParams(
  step: Extract<Step, { type: 'action' }>,
  params: Record<string, unknown>,
  stepResults: Record<string, unknown>,
): Record<string, unknown> {
  if (step.connector === 'slack' && step.action === 'message.send' && !params.text) {
    const text = latestTextFromResults(stepResults);
    return text ? { ...params, text } : params;
  }
  if (
    step.connector === 'gmail' &&
    (step.action === 'message.send' || step.action === 'draft.create') &&
    !params.body
  ) {
    const body = latestTextFromResults(stepResults);
    return body ? { ...params, body } : params;
  }
  return params;
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
      const resolvedParams = resolveStepParams(step.params, ctx, stepResults);
      let params =
        step.connector === 'document' && step.action === 'ingest'
          ? resolveDocumentIngestParams(resolvedParams, ctx.variables)
          : step.connector === 'transform'
            ? resolveTransformParams(step.action, resolvedParams, stepResults, ctx)
            : resolvedParams;
      params = enrichMessagingParams(step, params, stepResults);
      const result = await connector.execute(
        step.action,
        params,
        ctx,
      );
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
