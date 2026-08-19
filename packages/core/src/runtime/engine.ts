import type { SkillIR, Step } from '../skill/schema.js';
import { parseSkillIR } from '../skill/schema.js';
import type { Connector, ConnectorContext, ExecutionLogEntry } from '../connectors/types.js';
import { MockGmailConnector, MockSlackConnector } from '../connectors/mocks/index.js';
import { createDefaultConnectors } from '../connectors/registry.js';
import type { AgentHarness } from '../agent/harness.js';
import type { RuntimeConfig, ExecutionResult } from './types.js';
import { executeStep } from './step-executor.js';
import { resolveStepParams } from './ai-investigation.js';
import {
  isExecutionCheckpoint,
  linearSteps,
  stepsById,
  type ExecutionCheckpoint,
} from './control-flow.js';

type PendingError = Error & {
  code?: string;
  approvalId?: string;
  pending?: boolean;
  checkpoint?: ExecutionCheckpoint;
};

export class SkillRuntime {
  connectors: Record<string, Connector>;
  private readonly fallbackMockGmail = new MockGmailConnector();
  private readonly fallbackMockSlack = new MockSlackConnector();

  constructor(private config: RuntimeConfig) {
    this.connectors = { ...createDefaultConnectors(), ...config.connectors };
  }

  /** Test and dev helper when the runtime uses mock Gmail. */
  get mockGmail(): MockGmailConnector {
    const gmail = this.connectors.gmail;
    return gmail instanceof MockGmailConnector ? gmail : this.fallbackMockGmail;
  }

  get mockSlack(): MockSlackConnector {
    const slack = this.connectors.slack;
    return slack instanceof MockSlackConnector ? slack : this.fallbackMockSlack;
  }

  async executeSkill(
    ir: SkillIR,
    options: { ephemeral?: boolean; triggerType?: string; input?: Record<string, unknown> } = {},
  ): Promise<ExecutionResult> {
    if (!this.config.globalActive) {
      return {
        executionId: '',
        status: 'cancelled',
        errorCode: 'global_off_duty',
        log: [{ at: new Date().toISOString(), level: 'warn', code: 'global_off_duty', message: '전역 퇴근 상태입니다.' }],
      };
    }

    if (ir.id && this.config.skillActive[ir.id] === false) {
      return {
        executionId: '',
        status: 'cancelled',
        errorCode: 'skill_paused',
        log: [{ at: new Date().toISOString(), level: 'warn', code: 'skill_paused', message: 'Skill이 비활성화되어 있습니다.' }],
      };
    }

    const executionId = this.config.store.createExecution({
      skillId: ir.id,
      skillVersion: ir.version,
      ephemeral: options.ephemeral ?? false,
      triggerType: options.triggerType,
      irJson: JSON.stringify(ir),
    });
    this.config.onExecutionStarted?.(executionId);

    const log: ExecutionLogEntry[] = [];
    const ctx: ConnectorContext = {
      executionId,
      skillId: ir.id,
      variables: { ...options.input },
      log: (entry) => log.push(entry),
    };

    const stepResults: Record<string, unknown> = { ...(options.input ?? {}) };

    try {
      await this.runSequence(linearSteps(ir.steps), ir, ctx, stepResults);
      this.config.store.finishExecution(executionId, 'success', undefined, log);
      const result: ExecutionResult = { executionId, status: 'success', log };
      this.config.onExecutionFinished?.(result);
      return result;
    } catch (err) {
      const error = err as PendingError;
      if (error.pending && error.approvalId) {
        if (error.checkpoint) {
          this.config.store.updateApprovalPayload(error.approvalId, {
            checkpoint: error.checkpoint,
          });
        }
        this.config.store.finishExecution(executionId, 'failed', 'pending_approval', log);
        const result: ExecutionResult = {
          executionId,
          status: 'pending_approval',
          pendingApprovalId: error.approvalId,
          log,
        };
        this.config.onExecutionFinished?.(result);
        return result;
      }
      const code = error.code ?? 'execution_failed';
      log.push({ at: new Date().toISOString(), level: 'error', code, message: error.message });
      this.config.store.finishExecution(executionId, 'failed', code, log);
      const result: ExecutionResult = { executionId, status: 'failed', errorCode: code, log };
      this.config.onExecutionFinished?.(result);
      return result;
    }
  }

  private async runSequence(
    sequence: Step[],
    ir: SkillIR,
    ctx: ConnectorContext,
    stepResults: Record<string, unknown>,
  ): Promise<void> {
    for (let index = 0; index < sequence.length; index++) {
      const step = sequence[index];
      try {
        await executeStep(
          step,
          ir,
          ctx,
          stepResults,
          this.config.store,
          this.connectors,
          this.config.agentHarness,
          (ids) => this.runSequence(stepsById(ir.steps, ids), ir, ctx, stepResults),
        );
      } catch (err) {
        const error = err as PendingError;
        if (error.pending && !error.checkpoint) {
          error.checkpoint = {
            variables: { ...ctx.variables },
            stepResults: { ...stepResults },
            remainingStepIds: sequence.slice(index + 1).map((item) => item.id),
          };
        }
        throw error;
      }
    }
  }

  setGlobalActive(active: boolean) {
    this.config.globalActive = active;
  }

  setSkillActive(skillId: string, active: boolean) {
    this.config.skillActive[skillId] = active;
  }

  removeSkill(skillId: string) {
    delete this.config.skillActive[skillId];
  }

  setAgentHarness(agentHarness: AgentHarness) {
    this.config.agentHarness = agentHarness;
  }

  async continueAfterApproval(approvalId: string): Promise<ExecutionResult> {
    const approval = this.config.store.getApproval(approvalId);
    if (!approval || approval.status !== 'pending') {
      return { executionId: '', status: 'failed', errorCode: 'approval_not_found', log: [] };
    }

    const execution = this.config.store.getExecution(approval.executionId);
    if (!execution) {
      return { executionId: '', status: 'failed', errorCode: 'execution_not_found', log: [] };
    }

    let ir = execution.skillId
      ? this.config.store.getSkill(execution.skillId, execution.skillVersion ?? undefined)
      : null;
    if (execution.irJson) {
      try {
        ir = parseSkillIR(JSON.parse(execution.irJson));
      } catch {
        /* keep skill store copy */
      }
    }

    const log: ExecutionLogEntry[] = JSON.parse(execution.logJson ?? '[]') as ExecutionLogEntry[];
    const payload = approval.payload as { checkpoint?: unknown } | undefined;
    const checkpoint = isExecutionCheckpoint(payload?.checkpoint) ? payload.checkpoint : undefined;
    const ctx: ConnectorContext = {
      executionId: execution.id,
      skillId: execution.skillId ?? undefined,
      variables: { ...(checkpoint?.variables ?? {}) },
      log: (entry) => log.push(entry),
    };
    const stepResults: Record<string, unknown> = { ...(checkpoint?.stepResults ?? {}) };

    try {
      for (const actionId of approval.actionIds) {
        const actionStep = ir?.steps.find((s: Step) => s.type === 'action' && s.id === actionId);
        if (!actionStep || actionStep.type !== 'action') continue;
        const connector = this.connectors[actionStep.connector];
        if (!connector) {
          throw Object.assign(new Error(`Connector not found: ${actionStep.connector}`), {
            code: 'connector_missing',
          });
        }
        const result = await connector.execute(
          actionStep.action,
          resolveStepParams(actionStep.params, ctx, stepResults),
          ctx,
        );
        if (!result.ok) {
          throw Object.assign(new Error(result.error ?? 'approved action failed'), { code: result.errorCode });
        }
        stepResults[actionId] = result.data;
      }

      if (ir && checkpoint?.remainingStepIds.length) {
        await this.runSequence(stepsById(ir.steps, checkpoint.remainingStepIds), ir, ctx, stepResults);
      }

      this.config.store.resolveApproval(approvalId, true);
      this.config.store.finishExecution(execution.id, 'success', undefined, log);
      const successResult: ExecutionResult = { executionId: execution.id, status: 'success', log };
      this.config.onExecutionFinished?.(successResult);
      return successResult;
    } catch (err) {
      const error = err as PendingError;
      if (error.pending && error.approvalId) {
        if (error.checkpoint) {
          this.config.store.updateApprovalPayload(error.approvalId, {
            checkpoint: error.checkpoint,
          });
        }
        this.config.store.finishExecution(execution.id, 'failed', 'pending_approval', log);
        const pendingResult: ExecutionResult = {
          executionId: execution.id,
          status: 'pending_approval',
          pendingApprovalId: error.approvalId,
          log,
        };
        this.config.onExecutionFinished?.(pendingResult);
        return pendingResult;
      }
      const code = error.code ?? 'execution_failed';
      log.push({ at: new Date().toISOString(), level: 'error', code, message: error.message });
      this.config.store.finishExecution(execution.id, 'failed', code, log);
      const failedResult: ExecutionResult = { executionId: execution.id, status: 'failed', errorCode: code, log };
      this.config.onExecutionFinished?.(failedResult);
      return failedResult;
    }
  }
}
