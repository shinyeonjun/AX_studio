import { randomUUID } from 'node:crypto';
import type { WorkflowIR, Step } from '../workflow/schema.js';
import { parseWorkflowIR } from '../workflow/schema.js';
import { validateWorkflowContracts } from '../workflow/contract-validator.js';
import type { Connector, ConnectorContext, ExecutionLogEntry } from '../modules/types.js';
import type { InvestigationRunner } from '../agent/investigation-runner.js';
import type {
  ExecutionProgress,
  EphemeralExecutionQueueItem,
  RuntimeConfig,
  ExecutionResult,
  WorkflowExecutionOptions,
} from './types.js';
import { executeStep } from './step-executor.js';
import { resolveStepParams } from './param-resolution.js';
import { applyStepBindings, inferWorkflowBindings } from '../workflow/bindings.js';
import { resolveFileRef } from './source-resolver.js';
import { actionRefFor, resolveActionDefinition, validateActionParams } from '../workflow/action-definition.js';
import { resolveDocumentIngestExecution } from '../contracts/document-ingest-resolve.js';
import {
  isExecutionCheckpoint,
  linearSteps,
  stepsById,
  type ExecutionCheckpoint,
} from './control-flow.js';
import { validateExecutionLog } from './execution-log.js';

type PendingError = Error & {
  code?: string;
  approvalId?: string;
  pending?: boolean;
  checkpoint?: ExecutionCheckpoint;
};

export class WorkflowRuntime {
  connectors: Record<string, Connector>;
  private activeExecutionCount = 0;
  private idleWaiters: Array<() => void> = [];
  private ephemeralQueueTail: Promise<void> = Promise.resolve();

  constructor(private config: RuntimeConfig) {
    this.connectors = { ...(config.connectors ?? {}) };
  }

  async executeWorkflow(
    ir: WorkflowIR,
    options: WorkflowExecutionOptions = {},
  ): Promise<ExecutionResult> {
    this.activeExecutionCount += 1;
    try {
      return await this.executeWorkflowInternal(ir, options);
    } finally {
      this.activeExecutionCount -= 1;
      if (this.activeExecutionCount === 0) {
        const waiters = this.idleWaiters.splice(0);
        waiters.forEach((resolve) => resolve());
      }
    }
  }

  /** Queue a one-shot plan without creating a saved workflow. */
  enqueueEphemeralWorkflow(
    ir: WorkflowIR,
    options: Omit<WorkflowExecutionOptions, 'ephemeral'> = {},
  ): EphemeralExecutionQueueItem {
    const jobId = randomUUID();
    const run = this.ephemeralQueueTail.then(() =>
      this.executeWorkflow(ir, {
        ...options,
        ephemeral: true,
        forceManual: true,
      }),
    );
    this.ephemeralQueueTail = run.then(() => undefined, () => undefined);
    void run.catch(() => undefined);
    return { jobId };
  }

  /** Waits until in-flight workflow writes have finished before the host closes the database. */
  async waitForIdle(): Promise<void> {
    await this.ephemeralQueueTail;
    if (this.activeExecutionCount === 0) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  private async executeWorkflowInternal(
    ir: WorkflowIR,
    options: WorkflowExecutionOptions = {},
  ): Promise<ExecutionResult> {
    let parsedIr: WorkflowIR;
    try {
      parsedIr = parseWorkflowIR(ir);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.recordPreflightResult(options, undefined, 'failed', 'invalid_workflow_schema', message);
    }
    ir = parsedIr;

    if (!this.config.globalActive) {
      return this.recordPreflightResult(
        options,
        ir,
        'cancelled',
        'global_off_duty',
        '전역 퇴근 상태입니다.',
      );
    }

    if (ir.id && this.config.workflowActive[ir.id] === false && !options.forceManual) {
      return this.recordPreflightResult(
        options,
        ir,
        'cancelled',
        'workflow_paused',
        '워크플로우가 중지되어 있습니다.',
      );
    }

    const contractIssues = validateWorkflowContracts(ir, { runtimeConnectors: this.connectors });
    if (contractIssues.length > 0) {
      const issue = contractIssues[0]!;
      return this.recordPreflightResult(
        options,
        ir,
        'failed',
        'contract_validation_failed',
        issue.message,
        { issues: contractIssues },
      );
    }

    let workflowIr = inferWorkflowBindings(ir);

    const executionId = this.config.store.createExecution({
      workflowId: options.ephemeral ? undefined : workflowIr.id,
      workflowVersion: workflowIr.version,
      ephemeral: options.ephemeral ?? false,
      triggerType: options.triggerType,
      irJson: JSON.stringify(workflowIr),
    });
    this.config.onExecutionStarted?.(executionId);

    const log: ExecutionLogEntry[] = [];
    const appendLog = (entry: ExecutionLogEntry) => {
      log.push(entry);
      this.config.store.updateExecutionLog(executionId, log);
    };
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
      log: appendLog,
    };

    const stepResults: Record<string, unknown> = { ...(options.input ?? {}) };

    try {
      await this.runSequence(linearSteps(workflowIr.steps), workflowIr, ctx, stepResults, [], new Set());
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
        this.config.store.markExecutionPending(executionId, 'pending_approval', log);
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

  private recordPreflightResult(
    options: WorkflowExecutionOptions,
    ir: WorkflowIR | undefined,
    status: 'failed' | 'cancelled',
    errorCode: string,
    message: string,
    data?: unknown,
  ): ExecutionResult {
    let irJson: string | undefined;
    if (ir) {
      try {
        irJson = JSON.stringify(ir);
      } catch {
        irJson = undefined;
      }
    }
    const executionId = this.config.store.createExecution({
      workflowId: options.ephemeral ? undefined : ir?.id,
      workflowVersion: ir?.version,
      ephemeral: options.ephemeral ?? false,
      triggerType: options.triggerType,
      irJson,
    });
    this.config.onExecutionStarted?.(executionId);
    const log: ExecutionLogEntry[] = [{
      at: new Date().toISOString(),
      level: status === 'failed' ? 'error' : 'warn',
      code: errorCode,
      message,
      ...(data === undefined ? {} : { data }),
    }];
    this.config.store.finishExecution(executionId, status, errorCode, log);
    const result: ExecutionResult = { executionId, status, errorCode, log };
    this.config.onExecutionFinished?.(result);
    return result;
  }

  private async runSequence(
    sequence: Step[],
    ir: WorkflowIR,
    ctx: ConnectorContext,
    stepResults: Record<string, unknown>,
    afterSequenceStepIds: string[] = [],
    approvedActionIds: ReadonlySet<string> = new Set(),
    executeAfterSequence = true,
  ): Promise<void> {
    for (let index = 0; index < sequence.length; index++) {
      const step = sequence[index];
      try {
        this.reportStepProgress(ctx, step, 'step_started');
        await executeStep(
          step,
          ir,
          ctx,
          stepResults,
          this.config.store,
          this.connectors,
          this.config.investigationRunner,
          (ids) =>
            this.runSequence(
              stepsById(ir.steps, ids),
              ir,
              ctx,
              stepResults,
              sequence.slice(index + 1).map((item) => item.id),
              approvedActionIds,
              false,
            ),
          approvedActionIds,
        );
        this.reportStepProgress(ctx, step, 'step_completed');
      } catch (err) {
        const error = err as PendingError;
        this.reportStepProgress(
          ctx,
          step,
          error.pending ? 'waiting_approval' : 'step_failed',
          error.pending ? '승인을 기다리고 있습니다.' : error.message,
        );
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
    // A normal branch returns to its parent loop. The continuation is executed
    // only when resuming from an approval checkpoint, where there is no parent
    // loop left to continue the original sequence.
    if (executeAfterSequence && afterSequenceStepIds.length > 0) {
      await this.runSequence(
        stepsById(ir.steps, afterSequenceStepIds),
        ir,
        ctx,
        stepResults,
        [],
        approvedActionIds,
      );
    }
  }

  private reportStepProgress(
    ctx: ConnectorContext,
    step: Step,
    status: ExecutionProgress['status'],
    message = status === 'step_started' ? '단계를 시작했습니다.' : '단계를 완료했습니다.',
  ): void {
    const at = new Date().toISOString();
    ctx.log({
      at,
      level: status === 'step_failed' ? 'error' : status === 'waiting_approval' ? 'warn' : 'info',
      code: status,
      message,
      data: { stepId: step.id, stepType: step.type },
    });
    this.config.onExecutionProgress?.({
      executionId: ctx.executionId,
      stepId: step.id,
      status,
      at,
      message,
    });
  }

  setGlobalActive(active: boolean) {
    this.config.globalActive = active;
  }

  setWorkflowActive(workflowId: string, active: boolean) {
    this.config.workflowActive[workflowId] = active;
  }

  /** Keep live connector instances aligned with connection changes made after startup. */
  setConnector(connectorId: string, connector: Connector | null): void {
    if (connector) {
      this.connectors[connectorId] = connector;
      return;
    }
    delete this.connectors[connectorId];
  }

  removeWorkflow(workflowId: string) {
    delete this.config.workflowActive[workflowId];
  }

  setInvestigationRunner(investigationRunner: InvestigationRunner) {
    this.config.investigationRunner = investigationRunner;
  }

  async continueAfterApproval(approvalId: string): Promise<ExecutionResult> {
    const approval = this.config.store.getApproval(approvalId);
    if (!approval) {
      return { executionId: '', status: 'failed', errorCode: 'approval_not_found', log: [] };
    }
    if (approval.status !== 'pending') {
      return {
        executionId: approval.executionId,
        status: 'failed',
        errorCode: approval.status === 'processing' ? 'approval_in_progress' : 'approval_already_resolved',
        log: [],
      };
    }
    // Approval is an external side-effect boundary. Turning the global
    // execution switch off must also block a later approval resume; leave the
    // approval pending so it can be retried after the user turns execution on.
    if (!this.config.globalActive) {
      return {
        executionId: approval.executionId,
        status: 'cancelled',
        errorCode: 'global_off_duty',
        log: [],
      };
    }
    if (!this.config.store.claimApproval(approvalId)) {
      return { executionId: approval.executionId, status: 'failed', errorCode: 'approval_in_progress', log: [] };
    }

    const execution = this.config.store.getExecution(approval.executionId);
    if (!execution) {
      this.config.store.failApproval(approvalId);
      return { executionId: approval.executionId, status: 'failed', errorCode: 'execution_not_found', log: [] };
    }

    let ir: WorkflowIR;
    if (!execution.irJson) {
      this.config.store.failApproval(approvalId);
      const log = [{
        at: new Date().toISOString(),
        level: 'error' as const,
        code: 'invalid_execution_snapshot',
        message: '승인 재개에 필요한 실행 스냅샷이 없습니다.',
      }];
      this.config.store.finishExecution(execution.id, 'failed', 'invalid_execution_snapshot', log);
      return { executionId: approval.executionId, status: 'failed', errorCode: 'invalid_execution_snapshot', log };
    }
    try {
      ir = parseWorkflowIR(JSON.parse(execution.irJson));
    } catch (error) {
      this.config.store.failApproval(approvalId);
      const message = error instanceof Error ? error.message : String(error);
      const log = [{
        at: new Date().toISOString(),
        level: 'error' as const,
        code: 'invalid_execution_snapshot',
        message: `승인 재개에 필요한 실행 스냅샷이 손상되었습니다: ${message}`,
      }];
      this.config.store.finishExecution(execution.id, 'failed', 'invalid_execution_snapshot', log);
      return {
        executionId: approval.executionId,
        status: 'failed',
        errorCode: 'invalid_execution_snapshot',
        log,
      };
    }

    let log: ExecutionLogEntry[];
    try {
      const parsedLog: unknown = JSON.parse(execution.logJson ?? '[]');
      log = validateExecutionLog(parsedLog);
    } catch (error) {
      this.config.store.failApproval(approvalId);
      const message = error instanceof Error ? error.message : String(error);
      const failureLog = [{
        at: new Date().toISOString(),
        level: 'error' as const,
        code: 'invalid_execution_log',
        message: `승인 재개에 필요한 실행 로그가 손상되었습니다: ${message}`,
      }];
      this.config.store.finishExecution(execution.id, 'failed', 'invalid_execution_log', failureLog);
      return {
        executionId: approval.executionId,
        status: 'failed',
        errorCode: 'invalid_execution_log',
        log: failureLog,
      };
    }
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
      log: (entry) => {
        log.push(entry);
        this.config.store.updateExecutionLog(execution.id, log);
      },
    };
    const stepResults: Record<string, unknown> = { ...(checkpoint?.stepResults ?? {}) };

    try {
      const contractIssues = validateWorkflowContracts(ir, { runtimeConnectors: this.connectors });
      if (contractIssues.length > 0) {
        throw Object.assign(new Error(contractIssues[0]!.message), {
          code: 'contract_validation_failed',
          data: { issues: contractIssues },
        });
      }
      const remainingStepIds = new Set(checkpoint?.remainingStepIds ?? []);
      for (const actionId of approval.actionIds) {
        // A branch may have captured the approved action in its remaining sequence.
        // In that case runSequence will execute it exactly once with this approval present.
        if (remainingStepIds.has(actionId)) continue;
        const actionStep = ir?.steps.find((s: Step) => s.type === 'action' && s.id === actionId);
        if (!actionStep || actionStep.type !== 'action') continue;
        const actionRef = actionStep.actionRef ?? actionRefFor(actionStep.connector, actionStep.action);
        const actionDefinition = resolveActionDefinition(actionRef);
        if (!actionDefinition) {
          throw Object.assign(new Error(`Unknown action definition: ${actionRef}`), { code: 'unknown_action' });
        }
        const connector = this.connectors[actionDefinition.connector];
        if (!connector) {
          throw Object.assign(new Error(`Connector not found: ${actionDefinition.connector}`), {
            code: 'connector_missing',
          });
        }
        let params = applyStepBindings(actionStep, ir, actionStep.params, stepResults, ctx.variables);
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
            { code: 'action_params_missing' },
          );
        }
        const result = await connector.execute(
          actionDefinition.action,
          params,
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
          new Set(approval.actionIds),
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
        this.config.store.resolveApproval(approvalId, true);
        this.config.store.markExecutionPending(execution.id, 'pending_approval', log);
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
      this.config.store.resolveApproval(approvalId, true);
      this.config.store.finishExecution(execution.id, 'failed', code, log);
      const failedResult: ExecutionResult = { executionId: execution.id, status: 'failed', errorCode: code, log };
      this.config.onExecutionFinished?.(failedResult);
      return failedResult;
    }
  }
}
