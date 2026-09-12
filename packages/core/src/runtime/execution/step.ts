import type { WorkflowIR, Step } from '../../workflow/schema.js';
import type { ConnectorContext } from '../../connectors/types.js';
import { runAiDecision, evaluateCondition } from '../ai-investigation.js';
import type { WorkflowExecutionHost } from './contracts.js';
import { executeAction } from './action.js';

export async function executeStep(
  host: WorkflowExecutionHost,
  step: Step,
  ir: WorkflowIR,
  ctx: ConnectorContext,
  stepResults: Record<string, unknown>,
  runSteps: (stepIds: string[]) => Promise<void>,
  approvedActionIds: ReadonlySet<string> = new Set(),
): Promise<void> {
  switch (step.type) {
    case 'action':
      await executeAction(host, step, ir, ctx, stepResults, approvedActionIds);
      break;

    case 'ai_decision':
      await runAiDecision(step, ir, ctx, stepResults, host.config.investigationRunner, host.connectors);
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

    case 'human_approval': {
      const pendingActionIds = step.forActionIds.filter((actionId) => !approvedActionIds.has(actionId));
      if (step.forActionIds.length > 0 && pendingActionIds.length === 0) break;
      const humanApprovalId = host.config.store.createApproval({
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
