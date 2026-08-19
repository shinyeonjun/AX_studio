import type { WorkflowIR, Step } from '../workflow/schema.js';
import { parseWorkflowIR } from '../workflow/schema.js';
import { validateWorkflowContracts } from '../workflow/contract-validator.js';
import type { Connector, ConnectorContext, ExecutionLogEntry } from '../modules/types.js';
import { MockGmailConnector, MockLocalFolderConnector, MockSlackConnector } from '../modules/mocks/index.js';
import { createDefaultConnectors } from '../modules/registry.js';
import type { AgentHarness } from '../agent/harness.js';
import type { RuntimeConfig, ExecutionResult } from './types.js';
import { executeStep } from './step-executor.js';
import { resolveStepParams } from './ai-investigation.js';
import { inferWorkflowBindings } from '../workflow/bindings.js';
import { resolveFileRef } from './source-resolver.js';
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

export class WorkflowRuntime {
  connectors: Record<string, Connector>;
  private readonly fallbackMockGmail = new MockGmailConnector();
  private readonly fallbackMockSlack = new MockSlackConnector();
  private readonly fallbackMockLocalFolder = new MockLocalFolderConnector();

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

  get mockLocalFolder(): MockLocalFolderConnector {
    const localFolder = this.connectors.local_folder;
    return localFolder instanceof MockLocalFolderConnector ? localFolder : this.fallbackMockLocalFolder;
  }

  async executeWorkflow(
    ir: WorkflowIR,
    options: {
      ephemeral?: boolean;
      triggerType?: string;
      input?: Record<string, unknown>;
      /** Explicit manual run from UI — inactive ephemeral workflows may still run once. */
      forceManual?: boolean;
    } = {},
  ): Promise<ExecutionResult> {
    if (!this.config.globalActive) {
      return {
        executionId: '',
        status: 'cancelled',
        errorCode: 'global_off_duty',
        log: [{ at: new Date().toISOString(), level: 'warn', code: 'global_off_duty', message: '전역 퇴근 상태입니다.' }],
      };
    }

    if (ir.id && this.config.workflowActive[ir.id] === false && !options.forceManual) {
      return {
        executionId: '',
        status: 'cancelled',
        errorCode: 'workflow_paused',
        log: [{ at: new Date().toISOString(), level: 'warn', code: 'workflow_paused', message: '워크플로우가 중지되어 있습니다.' }],
      };
    }

    const contractIssues = validateWorkflowContracts(ir);
    if (contractIssues.length > 0) {
      const issue = contractIssues[0]!;
      return {
        executionId: '',
        status: 'failed',
        errorCode: 'contract_validation_failed',
        log: [
          {
            at: new Date().toISOString(),
            level: 'error',
            code: 'contract_validation_failed',
            message: issue.message,
            data: { issues: contractIssues },
          },
        ],
      };
    }

    let workflowIr = inferWorkflowBindings(ir);

    const executionId = this.config.store.createExecution({
      workflowId: workflowIr.id,
      workflowVersion: workflowIr.version,
      ephemeral: options.ephemeral ?? false,
      triggerType: options.triggerType,
      irJson: JSON.stringify(workflowIr),
    });
    this.config.onExecutionStarted?.(executionId);

    const log: ExecutionLogEntry[] = [];
    const connections = this.config.store.getConnections();
    const ctx: ConnectorContext = {
      executionId,
      workflowId: workflowIr.id,
      variables: { ...options.input },
      connections,
      resolveFileRef: (file) => {
        const resolved = resolveFileRef(file, connections);
        return resolved.ok
          ? { ok: true, path: resolved.path, file: resolved.file }
          : { ok: false, error: resolved.error, errorCode: resolved.errorCode };
      },
      log: (entry) => log.push(entry),
    };

    const stepResults: Record<string, unknown> = { ...(options.input ?? {}) };

    try {
      await this.runSequence(linearSteps(workflowIr.steps), workflowIr, ctx, stepResults, []);
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
    ir: WorkflowIR,
    ctx: ConnectorContext,
    stepResults: Record<string, unknown>,
    afterSequenceStepIds: string[] = [],
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
          (ids) =>
            this.runSequence(
              stepsById(ir.steps, ids),
              ir,
              ctx,
              stepResults,
              sequence.slice(index + 1).map((item) => item.id),
            ),
        );
      } catch (err) {
        const error = err as PendingError;
        if (error.pending && !error.checkpoint) {
          error.checkpoint = {
            variables: { ...ctx.variables },
            stepResults: { ...stepResults },
            remainingStepIds: sequence.slice(index + 1).map((item) => item.id),
            pendingOuterStepIds: afterSequenceStepIds,
          };
        } else if (error.pending && error.checkpoint && afterSequenceStepIds.length > 0) {
          error.checkpoint = {
            ...error.checkpoint,
            pendingOuterStepIds: [
              ...(error.checkpoint.pendingOuterStepIds ?? []),
              ...afterSequenceStepIds,
            ],
          };
        }
        throw error;
      }
    }
    if (afterSequenceStepIds.length > 0) {
      await this.runSequence(stepsById(ir.steps, afterSequenceStepIds), ir, ctx, stepResults);
    }
  }

  setGlobalActive(active: boolean) {
    this.config.globalActive = active;
  }

  setWorkflowActive(workflowId: string, active: boolean) {
    this.config.workflowActive[workflowId] = active;
  }

  removeWorkflow(workflowId: string) {
    delete this.config.workflowActive[workflowId];
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

    let ir = execution.workflowId
      ? this.config.store.getWorkflow(execution.workflowId, execution.workflowVersion ?? undefined)
      : null;
    if (execution.irJson) {
      try {
        ir = parseWorkflowIR(JSON.parse(execution.irJson));
      } catch {
        /* keep skill store copy */
      }
    }

    const log: ExecutionLogEntry[] = JSON.parse(execution.logJson ?? '[]') as ExecutionLogEntry[];
    const payload = approval.payload as { checkpoint?: unknown } | undefined;
    const checkpoint = isExecutionCheckpoint(payload?.checkpoint) ? payload.checkpoint : undefined;
    const connections = this.config.store.getConnections();
    const ctx: ConnectorContext = {
      executionId: execution.id,
      workflowId: execution.workflowId ?? undefined,
      variables: { ...(checkpoint?.variables ?? {}) },
      connections,
      resolveFileRef: (file) => {
        const resolved = resolveFileRef(file, connections);
        return resolved.ok
          ? { ok: true, path: resolved.path, file: resolved.file }
          : { ok: false, error: resolved.error, errorCode: resolved.errorCode };
      },
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
        await this.runSequence(
          stepsById(ir.steps, checkpoint.remainingStepIds),
          ir,
          ctx,
          stepResults,
          checkpoint.pendingOuterStepIds ?? [],
        );
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
