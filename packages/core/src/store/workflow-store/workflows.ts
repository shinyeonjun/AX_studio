import type { AppDatabase } from '../db.js';
import type { AgentScopedContextPatch } from '../../agent/scoped-context.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import * as workflowRepo from '../repositories/workflow-repository.js';

export function saveWorkflow(db: AppDatabase, ir: WorkflowIR) {
  return workflowRepo.saveWorkflow(db, ir);
}

export function getWorkflow(db: AppDatabase, workflowId: string, version?: number) {
  return workflowRepo.getWorkflow(db, workflowId, version);
}

export function getWorkflowPolicy(db: AppDatabase, workflowId: string) {
  return workflowRepo.getWorkflowPolicy(db, workflowId);
}

export function updateWorkflowPolicy(
  db: AppDatabase,
  workflowId: string,
  patch: AgentScopedContextPatch,
) {
  return workflowRepo.updateWorkflowPolicy(db, workflowId, patch);
}

export function listWorkflows(db: AppDatabase) {
  return workflowRepo.listWorkflows(db);
}

export function setWorkflowActive(db: AppDatabase, workflowId: string, active: boolean) {
  return workflowRepo.setWorkflowActive(db, workflowId, active);
}

export function deleteWorkflow(db: AppDatabase, workflowId: string) {
  return workflowRepo.deleteWorkflow(db, workflowId);
}
