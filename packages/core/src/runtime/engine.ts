import type { SkillIR, Step } from '../skill/schema.js';
import { parseSkillIR } from '../skill/schema.js';
import type { Connector, ConnectorContext, ExecutionLogEntry } from '../connectors/types.js';
import { MockGmailConnector, MockSlackConnector } from '../connectors/mocks/index.js';
import { createDefaultConnectors } from '../connectors/registry.js';
import type { ModelProvider } from '../models/provider.js';
import type { RuntimeConfig, ExecutionResult } from './types.js';
import { executeStep } from './step-executor.js';
import { resolveStepParams } from './ai-investigation.js';

export class SkillRuntime {
  connectors: Record<string, Connector>;
  mockGmail: MockGmailConnector;
  mockSlack: MockSlackConnector;

  constructor(private config: RuntimeConfig) {
    this.connectors = { ...createDefaultConnectors(), ...config.connectors };
    this.mockGmail = (this.connectors.gmail as MockGmailConnector) ?? new MockGmailConnector();
    this.mockSlack = (this.connectors.slack as MockSlackConnector) ?? new MockSlackConnector();
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

    const log: ExecutionLogEntry[] = [];
    const ctx: ConnectorContext = {
      executionId,
      skillId: ir.id,
      variables: { ...options.input },
      log: (entry) => log.push(entry),
    };

    const stepResults: Record<string, unknown> = {};

    try {
      for (const step of ir.steps) {
        await this.runStep(step, ir, ctx, stepResults);
      }

      this.config.store.finishExecution(executionId, 'success', undefined, log);
      return { executionId, status: 'success', log };
    } catch (err) {
      const error = err as Error & { code?: string; approvalId?: string; pending?: boolean };
      if (error.pending && error.approvalId) {
        this.config.store.finishExecution(executionId, 'failed', 'pending_approval', log);
        return {
          executionId,
          status: 'pending_approval',
          pendingApprovalId: error.approvalId,
          log,
        };
      }
      const code = error.code ?? 'execution_failed';
      log.push({ at: new Date().toISOString(), level: 'error', code, message: error.message });
      this.config.store.finishExecution(executionId, 'failed', code, log);
      return { executionId, status: 'failed', errorCode: code, log };
    }
  }

  private async runStep(
    step: SkillIR['steps'][number],
    ir: SkillIR,
    ctx: ConnectorContext,
    stepResults: Record<string, unknown>,
  ): Promise<void> {
    await executeStep(
      step,
      ir,
      ctx,
      stepResults,
      this.config.store,
      this.connectors,
      this.config.model,
      this.mockGmail,
      (target) => this.runStep(target, ir, ctx, stepResults),
    );
  }

  setGlobalActive(active: boolean) {
    this.config.globalActive = active;
  }

  setSkillActive(skillId: string, active: boolean) {
    this.config.skillActive[skillId] = active;
  }

  setModel(model: ModelProvider) {
    this.config.model = model;
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
    const ctx: ConnectorContext = {
      executionId: execution.id,
      skillId: execution.skillId ?? undefined,
      variables: {},
      log: (entry) => log.push(entry),
    };
    const stepResults: Record<string, unknown> = {};

    try {
      for (const actionId of approval.actionIds) {
        const actionStep = ir?.steps.find((s: Step) => s.type === 'action' && s.id === actionId);
        if (!actionStep || actionStep.type !== 'action') continue;
        const connector = this.connectors[actionStep.connector];
        if (!connector) throw Object.assign(new Error(`Connector not found: ${actionStep.connector}`), { code: 'connector_missing' });
        const result = await connector.execute(
          actionStep.action,
          resolveStepParams(actionStep.params, ctx, stepResults),
          ctx,
        );
        if (!result.ok) throw Object.assign(new Error(result.error ?? 'approved action failed'), { code: result.errorCode });
        stepResults[actionId] = result.data;
      }

      this.config.store.resolveApproval(approvalId, true);
      this.config.store.finishExecution(execution.id, 'success', undefined, log);
      return { executionId: execution.id, status: 'success', log };
    } catch (err) {
      const error = err as Error & { code?: string };
      const code = error.code ?? 'execution_failed';
      log.push({ at: new Date().toISOString(), level: 'error', code, message: error.message });
      this.config.store.finishExecution(execution.id, 'failed', code, log);
      return { executionId: execution.id, status: 'failed', errorCode: code, log };
    }
  }
}
