import type { AppDatabase } from '../db.js';
import type { AgentScopedContextPatch } from '../../intelligence/agent/scoped-context.js';
import type { WorkflowIR } from '../../workflow/schema.js';
import * as workflowRepo from '../repositories/workflow-repository.js';

export class WorkflowDefinitionStore {
  // Main-process writers share this store; hold the id while async runtime cleanup drains.
  private readonly deletingWorkflowIds = new Set<string>();
  constructor(private readonly db: AppDatabase) {}

  saveWorkflow(ir: WorkflowIR) {
    if (ir.id && this.deletingWorkflowIds.has(ir.id)) {
      throw Object.assign(new Error(`Workflow deletion is in progress: ${ir.id}`), {
        code: 'workflow_deletion_in_progress',
      });
    }
    return workflowRepo.saveWorkflow(this.db, ir);
  }

  claimWorkflowDeletion(workflowId: string, expectedVersion: number): boolean {
    if (this.deletingWorkflowIds.has(workflowId)) return false;
    if (workflowRepo.getWorkflow(this.db, workflowId)?.version !== expectedVersion) return false;
    this.deletingWorkflowIds.add(workflowId);
    return true;
  }

  workflowExists(workflowId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM workflows WHERE id = ?').get(workflowId));
  }

  /**
   * Deletion claim for a workflow whose stored definition cannot be read (corrupt latest
   * version JSON, or a workflow row without any version). It never applies to a readable
   * workflow, which must use the version-checked claimWorkflowDeletion. The repository
   * delete still refuses while an execution is running or awaiting approval.
   */
  claimUnreadableWorkflowDeletion(workflowId: string): boolean {
    if (this.deletingWorkflowIds.has(workflowId)) return false;
    if (!this.workflowExists(workflowId)) return false;
    try {
      if (workflowRepo.getWorkflow(this.db, workflowId)) return false;
    } catch (error) {
      if ((error as { code?: unknown } | null)?.code !== 'invalid_workflow_json') throw error;
    }
    this.deletingWorkflowIds.add(workflowId);
    return true;
  }

  releaseWorkflowDeletion(workflowId: string): void {
    this.deletingWorkflowIds.delete(workflowId);
  }

  getWorkflow(workflowId: string, version?: number) { return workflowRepo.getWorkflow(this.db, workflowId, version); }
  getWorkflowPolicy(workflowId: string) { return workflowRepo.getWorkflowPolicy(this.db, workflowId); }
  updateWorkflowPolicy(workflowId: string, patch: AgentScopedContextPatch) {
    return workflowRepo.updateWorkflowPolicy(this.db, workflowId, patch);
  }
  listWorkflows() { return workflowRepo.listWorkflows(this.db); }
  listWorkflowDefinitions() { return workflowRepo.listWorkflowDefinitions(this.db); }
  listActiveWorkflowDefinitions() { return workflowRepo.listActiveWorkflowDefinitions(this.db); }
  isWorkflowActive(workflowId: string) { return workflowRepo.isWorkflowActive(this.db, workflowId); }
  workflowActiveState(workflowId: string) { return workflowRepo.workflowActiveState(this.db, workflowId); }
  setWorkflowActive(workflowId: string, active: boolean) {
    if (active && this.deletingWorkflowIds.has(workflowId)) {
      throw Object.assign(new Error(`Workflow deletion is in progress: ${workflowId}`), {
        code: 'workflow_deletion_in_progress',
      });
    }
    return workflowRepo.setWorkflowActive(this.db, workflowId, active);
  }
  deleteWorkflow(workflowId: string, options?: { deleteHistory?: boolean }) { return workflowRepo.deleteWorkflow(this.db, workflowId, options); }
}
