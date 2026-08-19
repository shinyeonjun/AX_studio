import type { SkillIR, Step } from '../skill/schema.js';
import { requiresApproval } from '../skill/approval.js';

function hasHumanApprovalForAction(ir: SkillIR, actionId: string): boolean {
  return ir.steps.some(
    (step) => step.type === 'human_approval' && step.forActionIds.includes(actionId),
  );
}
import type { Connector, ConnectorContext } from '../connectors/types.js';
import type { SkillStore } from '../store/skill-store.js';
import type { AgentHarness } from '../agent/harness.js';
import { runAiDecision, resolveStepParams, evaluateStepCondition } from './ai-investigation.js';

export async function executeStep(
  step: Step,
  ir: SkillIR,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
  store: SkillStore,
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
      const result = await connector.execute(
        step.action,
        resolveStepParams(step.params, ctx, stepResults),
        ctx,
      );
      if (!result.ok) throw Object.assign(new Error(result.error ?? 'action failed'), { code: result.errorCode ?? 'action_failed' });
      stepResults[step.id] = result.data;
      break;

    case 'ai_decision':
      await runAiDecision(step, ir, ctx, stepResults, agentHarness, connectors);
      break;

    case 'if':
      const cond = evaluateStepCondition(step.condition, stepResults);
      const ids = cond ? step.thenStepIds : step.elseStepIds ?? [];
      if (ids.length > 0) await runSteps(ids);
      break;

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
