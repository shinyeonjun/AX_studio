import { randomUUID } from 'node:crypto';
import type { InvestigationRunner } from '../agent/investigation-runner.js';
import type { Connector } from '../modules/types.js';
import type {
  EphemeralExecutionQueueItem,
  ExecutionProgress,
  ExecutionResult,
  RuntimeConfig,
  WorkflowExecutionOptions,
} from './types.js';
import { WorkflowExecutionRunner } from './execution/runner.js';

/**
 * Public lifecycle facade for workflow execution.
 *
 * Execution semantics live in WorkflowExecutionRunner. This module owns the
 * small amount of mutable lifecycle state that callers are allowed to change:
 * queueing, active execution tracking, connector updates, and observers.
 */
export class WorkflowRuntime {
  connectors: Record<string, Connector>;
  private activeExecutionCount = 0;
  private idleWaiters: Array<() => void> = [];
  private ephemeralQueueTail: Promise<void> = Promise.resolve();
  private readonly executionRunner: WorkflowExecutionRunner;

  constructor(private config: RuntimeConfig) {
    this.connectors = { ...(config.connectors ?? {}) };
    this.executionRunner = new WorkflowExecutionRunner({
      config: this.config,
      connectors: this.connectors,
      notifyExecutionStarted: (executionId) => this.notifyExecutionStarted(executionId),
      notifyExecutionProgress: (progress) => this.notifyExecutionProgress(progress),
      notifyExecutionFinished: (result) => this.notifyExecutionFinished(result),
    });
  }

  async executeWorkflow(
    ir: import('../workflow/schema.js').WorkflowIR,
    options: WorkflowExecutionOptions = {},
  ): Promise<ExecutionResult> {
    this.activeExecutionCount += 1;
    try {
      return await this.executionRunner.execute(ir, options);
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
    ir: import('../workflow/schema.js').WorkflowIR,
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

  private notifyExecutionStarted(executionId: string): void {
    try {
      this.config.onExecutionStarted?.(executionId);
    } catch {
      // Observers must not change execution outcomes.
    }
  }

  private notifyExecutionProgress(progress: ExecutionProgress): void {
    try {
      this.config.onExecutionProgress?.(progress);
    } catch {
      // Observers must not change execution outcomes.
    }
  }

  /** Notify host observers for every completion path, including preflight failures. */
  notifyExecutionFinished(result: ExecutionResult): void {
    try {
      this.config.onExecutionFinished?.(result);
    } catch {
      // Observers must not change execution outcomes.
    }
  }

  setGlobalActive(active: boolean): void {
    this.config.globalActive = active;
  }

  setWorkflowActive(workflowId: string, active: boolean): void {
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

  removeWorkflow(workflowId: string): void {
    delete this.config.workflowActive[workflowId];
  }

  setInvestigationRunner(investigationRunner: InvestigationRunner): void {
    this.config.investigationRunner = investigationRunner;
  }

  continueAfterApproval(approvalId: string): Promise<ExecutionResult> {
    return this.executionRunner.continueAfterApproval(approvalId);
  }
}
