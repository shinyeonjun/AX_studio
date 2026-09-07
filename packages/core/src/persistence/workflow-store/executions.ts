import type { AppDatabase } from '../db.js';
import type { ExecutionStatus } from '../rows.js';
import * as executionRepo from '../repositories/execution-repository.js';

export function createExecution(
  db: AppDatabase,
  params: {
    workflowId?: string;
    workflowVersion?: number;
    ephemeral: boolean;
    triggerType?: string;
    irJson?: string;
    workspaceSessionId?: string;
  },
) {
  return executionRepo.createExecution(db, params);
}

export function finishExecution(
  db: AppDatabase,
  id: string,
  status: Exclude<ExecutionStatus, 'running' | 'pending_approval'>,
  errorCode?: string,
  log?: unknown[],
) {
  executionRepo.finishExecution(db, id, status, errorCode, log);
}

export function markExecutionPending(
  db: AppDatabase,
  id: string,
  errorCode = 'pending_approval',
  log?: unknown[],
) {
  executionRepo.markExecutionPending(db, id, errorCode, log);
}

export function updateExecutionLog(db: AppDatabase, id: string, log: unknown[]) {
  executionRepo.updateExecutionLog(db, id, log);
}

export function getExecution(db: AppDatabase, id: string) {
  return executionRepo.getExecution(db, id);
}

export function listExecutions(db: AppDatabase, limit = 50) {
  return executionRepo.listExecutions(db, limit);
}

export function deleteExecution(db: AppDatabase, id: string) {
  return executionRepo.deleteExecution(db, id);
}

export function clearExecutions(db: AppDatabase) {
  return executionRepo.clearExecutions(db);
}
