import { randomUUID } from 'node:crypto';
import type { InvestigationRunner } from '../intelligence/agent/investigation-runner.js';
import type { DecisionEngine } from '../contracts/decision.js';
import type { Connector } from '../connectors/types.js';
import type {
  EphemeralExecutionQueueItem,
  ExecutionProgress,
  ExecutionResult,
  RuntimeConfig,
  WorkflowExecutionOptions,
} from './types.js';
import { WorkflowExecutionRunner } from './execution/runner.js';
import { ToolSendOutcomeSchema, type ToolDraftUpdate, type ToolReviewRequest, type ToolResultConfirmation } from '../contracts/tool-result.js';
import { ToolResultApprovals, requiresToolResultReview } from './tool-result-approval.js';

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
  private queuedExecutionCount = 0;
  private accepting = true;
  private idleWaiters: Array<() => void> = [];
  private readonly activeWorkflowRuns = new Map<string, Set<AbortController>>();
  private readonly workflowIdleWaiters = new Map<string, Array<() => void>>();
  private readonly removedWorkflowIds = new Map<string, undefined>();
  private ephemeralQueueTail: Promise<void> = Promise.resolve();
  private readonly executionRunner: WorkflowExecutionRunner;
  private readonly toolResults: ToolResultApprovals;

  constructor(private config: RuntimeConfig) {
    this.connectors = { ...(config.connectors ?? {}) };
    this.toolResults = new ToolResultApprovals(config.store, this.connectors);
    this.executionRunner = new WorkflowExecutionRunner({
      config: this.config,
      connectors: this.connectors,
      toolResults: this.toolResults,
      notifyExecutionStarted: (executionId) => this.notifyExecutionStarted(executionId),
      notifyExecutionProgress: (progress) => this.notifyExecutionProgress(progress),
      notifyExecutionFinished: (result) => this.notifyExecutionFinished(result),
    });
  }

  async executeWorkflow(
    ir: import('../workflow/schema.js').WorkflowIR,
    options: WorkflowExecutionOptions = {},
  ): Promise<ExecutionResult> {
    if (!this.accepting) throw new Error('runtime_stopping');
    if (ir.id && this.removedWorkflowIds.has(ir.id)) {
      throw Object.assign(new Error('workflow_removed'), { code: 'workflow_removed' });
    }
    const controller = new AbortController();
    const abortExternal = () => controller.abort(options.abortSignal?.reason);
    if (options.abortSignal?.aborted) abortExternal();
    options.abortSignal?.addEventListener('abort', abortExternal, { once: true });
    const workflowId = ir.id;
    if (workflowId) {
      const runs = this.activeWorkflowRuns.get(workflowId) ?? new Set<AbortController>();
      runs.add(controller);
      this.activeWorkflowRuns.set(workflowId, runs);
    }
    try {
      return await this.trackExecution(() => this.executionRunner.execute(ir, {
        ...options,
        abortSignal: controller.signal,
      }));
    } finally {
      options.abortSignal?.removeEventListener('abort', abortExternal);
      if (workflowId) {
        const runs = this.activeWorkflowRuns.get(workflowId);
        runs?.delete(controller);
        if (!runs || runs.size === 0) {
          this.activeWorkflowRuns.delete(workflowId);
          const waiters = this.workflowIdleWaiters.get(workflowId);
          if (waiters) {
            this.workflowIdleWaiters.delete(workflowId);
            waiters.forEach((resolve) => resolve());
          }
        }
      }
    }
  }

  private async trackExecution(run: () => Promise<ExecutionResult>): Promise<ExecutionResult> {
    this.activeExecutionCount += 1;
    try {
      return await run();
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
    if (!this.accepting) throw new Error('runtime_stopping');
    if (this.queuedExecutionCount >= 128) throw new Error('runtime_queue_full');
    this.queuedExecutionCount += 1;
    const jobId = randomUUID();
    const run = this.ephemeralQueueTail.then(() =>
      this.trackExecution(() => this.executionRunner.execute(ir, {
        ...options,
        jobId,
        ephemeral: true,
        forceManual: true,
      })),
    );
    this.ephemeralQueueTail = run.then(
      () => { this.queuedExecutionCount -= 1; },
      () => { this.queuedExecutionCount -= 1; },
    );
    void run.catch(() => undefined);
    return { jobId };
  }

  /** Waits until in-flight workflow writes have finished before the host closes the database. */
  async waitForIdle(): Promise<void> {
    await this.ephemeralQueueTail;
    if (this.activeExecutionCount === 0) return;
    await new Promise<void>((resolve) => this.idleWaiters.push(resolve));
  }

  stopAccepting(): void {
    this.accepting = false;
    this.toolResults.dispose();
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
  notifyExecutionFinished(result: ExecutionResult): boolean {
    try {
      this.config.onExecutionFinished?.(result);
      return true;
    } catch {
      // Preserve the provider outcome while making a failed refresh observable.
      result.refreshWarning = true;
      if (result.toolSendOutcome) {
        result.log.push({ at: new Date().toISOString(), level: 'warn', code: 'execution_refresh_failed',
          message: 'Provider outcome retained; completion observer refresh failed.' });
        try { this.config.store.updateExecutionLog(result.executionId, result.log); } catch { /* Keep the receipt authoritative. */ }
      }
      return false;
    }
  }

  setGlobalActive(active: boolean): void {
    this.config.globalActive = active;
  }

  setWorkflowActive(workflowId: string, active: boolean): void {
    if (active) this.removedWorkflowIds.delete(workflowId);
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

  async removeWorkflow(workflowId: string): Promise<void> {
    // Pending approvals have no live controller to drain; leave deletion to
    // the repository guard instead of partially pausing a workflow.
    if (this.config.store.hasPendingApprovalForWorkflow(workflowId)) return;
    this.removedWorkflowIds.delete(workflowId);
    this.removedWorkflowIds.set(workflowId, undefined);
    // ponytail: bound tombstones to 1024 IDs; a persistent deletion journal is unnecessary here.
    if (this.removedWorkflowIds.size > 1024) {
      const oldest = this.removedWorkflowIds.keys().next().value;
      if (oldest) this.removedWorkflowIds.delete(oldest);
    }
    this.config.workflowActive[workflowId] = false;
    for (const controller of this.activeWorkflowRuns.get(workflowId) ?? []) {
      controller.abort(new Error('workflow_removed'));
    }
    const runs = this.activeWorkflowRuns.get(workflowId);
    if (runs && runs.size > 0) {
      await new Promise<void>((resolve) => {
        const waiters = this.workflowIdleWaiters.get(workflowId) ?? [];
        waiters.push(resolve);
        this.workflowIdleWaiters.set(workflowId, waiters);
      });
    }
  }

  setInvestigationRunner(investigationRunner: InvestigationRunner): void {
    this.config.investigationRunner = investigationRunner;
  }

  setDecisionEngine(decisionEngine?: DecisionEngine): void {
    this.config.decisionEngine = decisionEngine;
  }

  continueAfterApproval(approvalId: string, confirmation?: ToolResultConfirmation): Promise<ExecutionResult> {
    if (!this.accepting) return Promise.reject(new Error('runtime_stopping'));
    return this.trackExecution(() => this.executionRunner.continueAfterApproval(approvalId, confirmation));
  }

  getToolResult(approvalId: string) { return this.toolResults.read(approvalId); }
  requiresToolResultReview(approvalId: string) { return requiresToolResultReview(this.config.store, approvalId); }
  getToolSendOutcome(approvalId: string) {
    const approval = this.config.store.getApproval(approvalId);
    if (!approval || approval.status === 'pending' || approval.status === 'processing') return undefined;
    const payload = approval.payload as { toolSendOutcome?: unknown; toolSendIntent?: unknown } | undefined;
    const parsed = ToolSendOutcomeSchema.safeParse(payload?.toolSendOutcome ??
      (payload?.toolSendIntent && typeof payload.toolSendIntent === 'object'
        ? { ...payload.toolSendIntent, status: 'unknown' } : undefined));
    return parsed.success ? parsed.data : undefined;
  }
  updateToolDraft(input: ToolDraftUpdate) { return this.toolResults.update(input); }
  reviewToolResult(input: ToolReviewRequest) { return this.toolResults.review(input); }
  discardToolDraft(approvalId: string) { this.toolResults.discard(approvalId); }
  discardSessionToolDrafts(sessionId: string) { this.toolResults.discardSession(sessionId); }
}
