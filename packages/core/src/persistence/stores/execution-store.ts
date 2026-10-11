import type { AppDatabase } from '../db.js';
import type { ExecutionStatus } from '../rows.js';
import * as executionRepo from '../repositories/execution-repository.js';
import * as retentionRepo from '../repositories/retention-repository.js';
import { listCorruptRows } from '../tolerant-rows.js';

export class ExecutionStore {
  constructor(private readonly db: AppDatabase) {}

  createExecution(params: {
    workflowId?: string;
    workflowVersion?: number;
    ephemeral: boolean;
    triggerType?: string;
    irJson?: string;
    workspaceSessionId?: string;
  }) {
    return executionRepo.createExecution(this.db, params);
  }
  finishExecution(
    id: string,
    status: Exclude<ExecutionStatus, 'running' | 'pending_approval'>,
    errorCode?: string,
    log?: unknown[],
    options?: { preserveHistory?: boolean },
  ) {
    executionRepo.finishExecution(this.db, id, status, errorCode, log, options);
  }
  markExecutionPending(id: string, errorCode = 'pending_approval', log?: unknown[]) {
    executionRepo.markExecutionPending(this.db, id, errorCode, log);
  }
  updateExecutionLog(id: string, log: unknown[]) { executionRepo.updateExecutionLog(this.db, id, log); }
  appendExecutionLog(id: string, entries: readonly unknown[]) { return executionRepo.appendExecutionLog(this.db, id, entries); }
  /** Bounded history retention; never touches active/pending executions or open approvals. */
  pruneHistory(policy?: retentionRepo.HistoryRetentionPolicy, now?: Date) {
    return retentionRepo.pruneHistory(this.db, policy, now);
  }
  /** Rows skipped by tolerant list reads (ids and error codes only). */
  listCorruptRows() { return listCorruptRows(this.db); }
  hasPendingApprovalForWorkflow(workflowId: string) {
    return executionRepo.hasPendingApprovalForWorkflow(this.db, workflowId);
  }
  getExecution(id: string) { return executionRepo.getExecution(this.db, id); }
  listUnfinishedExecutions() { return executionRepo.listUnfinishedExecutions(this.db); }
  getExecutionOutput(id: string) { return executionRepo.getExecutionOutput(this.db, id); }
  listExecutions(limit = 50, includeOutput = false) { return executionRepo.listExecutions(this.db, limit, includeOutput); }
  deleteExecution(id: string) { return executionRepo.deleteExecution(this.db, id); }
  clearExecutions() { return executionRepo.clearExecutions(this.db); }
}
