import type { AppDatabase } from './db.js';
import type { AgentScopedContextPatch } from '../intelligence/agent/scoped-context.js';
import type { TableArtifact } from '../contracts/artifacts/table.js';
import type { DiscoverySessionState } from '../work-discovery/schema.js';
import type { WorkflowIR } from '../workflow/schema.js';
import type { ExecutionStatus } from './rows.js';
import type {
  RepairCandidateOperation,
  RepairProposal,
  RepairReplaySummary,
} from '../workflow/repair.js';
import * as discoveryRepo from './repositories/work-discovery-repository.js';
import * as workspaceChatRepo from './repositories/workspace-chat-repository.js';
import * as workspaceSourceRepo from './repositories/workspace-source-repository.js';
import type {
  DiscoveryMetadataInput,
  DiscoveryMetadataRecord,
} from '../contracts/discovery-metadata.js';
import * as approvalRepo from './repositories/approval-repository.js';
import * as executionRepo from './repositories/execution-repository.js';
import * as repairRepo from './repositories/workflow-repair-repository.js';
import * as settingsRepo from './repositories/settings-repository.js';
import * as triggerReceiptRepo from './repositories/trigger-receipt-repository.js';
import * as workflowRepo from './repositories/workflow-repository.js';
import * as discoveryMetadata from './repositories/discovery-metadata-repository.js';

export class WorkflowStore {
  // Main-process writers share this store; hold the id while async runtime cleanup drains.
  private readonly deletingWorkflowIds = new Set<string>();
  // Invalidates derived catalogs without hashing large persisted connector configs.
  private connectionRevision = 0;

  constructor(private db: AppDatabase) {}

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
  setWorkflowActive(workflowId: string, active: boolean) {
    if (active && this.deletingWorkflowIds.has(workflowId)) {
      throw Object.assign(new Error(`Workflow deletion is in progress: ${workflowId}`), {
        code: 'workflow_deletion_in_progress',
      });
    }
    return workflowRepo.setWorkflowActive(this.db, workflowId, active);
  }
  deleteWorkflow(workflowId: string) { return workflowRepo.deleteWorkflow(this.db, workflowId); }

  saveWorkspaceChat(params: {
    id?: string;
    messages: workspaceChatRepo.WorkspaceChatMessage[];
    workflowId?: string | null;
  }) {
    return workspaceChatRepo.saveWorkspaceChat(this.db, params);
  }
  upsertWorkspaceChatExecutionResult(
    target: string | { workflowId: string },
    message: workspaceChatRepo.WorkspaceChatMessage & { kind: 'execution_result'; executionId: string },
  ) {
    return workspaceChatRepo.upsertWorkspaceChatExecutionResult(this.db, target, message);
  }
  getWorkspaceChat(id: string) { return workspaceChatRepo.getWorkspaceChat(this.db, id); }
  getWorkspaceChatMemo(sessionId: string) { return workspaceChatRepo.getWorkspaceChatMemo(this.db, sessionId); }
  updateWorkspaceChatMemo(sessionId: string, patch: AgentScopedContextPatch) {
    return workspaceChatRepo.updateWorkspaceChatMemo(this.db, sessionId, patch);
  }
  getWorkspaceChatByWorkflowId(workflowId: string) {
    return workspaceChatRepo.getWorkspaceChatByWorkflowId(this.db, workflowId);
  }
  listWorkspaceChats(limit = 50) { return workspaceChatRepo.listWorkspaceChats(this.db, limit); }
  deleteWorkspaceChat(id: string) { workspaceChatRepo.deleteWorkspaceChat(this.db, id); }
  refreshWorkspaceChatTitle(sessionId: string) {
    return workspaceChatRepo.refreshWorkspaceChatTitle(this.db, sessionId);
  }
  insertWorkspaceSource(record: workspaceSourceRepo.WorkspaceSourceRecord) {
    return workspaceSourceRepo.insertWorkspaceSource(this.db, record);
  }
  updateWorkspaceSource(
    id: string,
    patch: Partial<Omit<workspaceSourceRepo.WorkspaceSourceRecord, 'id' | 'sessionId' | 'artifactId' | 'fileName' | 'createdAt'>>,
  ) {
    return workspaceSourceRepo.updateWorkspaceSource(this.db, id, patch);
  }
  getWorkspaceSource(sessionId: string, id: string) {
    return workspaceSourceRepo.getWorkspaceSource(this.db, sessionId, id);
  }
  listWorkspaceSources(sessionId: string) {
    return workspaceSourceRepo.listWorkspaceSources(this.db, sessionId);
  }
  listProcessingWorkspaceSources() {
    return workspaceSourceRepo.listProcessingWorkspaceSources(this.db);
  }
  countWorkspaceSourcesForArtifact(artifactId: string, excludeSessionId: string) {
    return workspaceSourceRepo.countWorkspaceSourcesForArtifact(this.db, artifactId, excludeSessionId);
  }
  findReferencedWorkspaceSourceArtifacts(artifactIds: readonly string[], excludeSessionId: string) {
    return workspaceSourceRepo.findReferencedWorkspaceSourceArtifacts(this.db, artifactIds, excludeSessionId);
  }

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
  ) {
    executionRepo.finishExecution(this.db, id, status, errorCode, log);
  }
  markExecutionPending(id: string, errorCode = 'pending_approval', log?: unknown[]) {
    executionRepo.markExecutionPending(this.db, id, errorCode, log);
  }
  updateExecutionLog(id: string, log: unknown[]) { executionRepo.updateExecutionLog(this.db, id, log); }
  hasPendingApprovalForWorkflow(workflowId: string) {
    return executionRepo.hasPendingApprovalForWorkflow(this.db, workflowId);
  }
  getExecution(id: string) { return executionRepo.getExecution(this.db, id); }
  listExecutions(limit = 50) { return executionRepo.listExecutions(this.db, limit); }
  deleteExecution(id: string) { return executionRepo.deleteExecution(this.db, id); }
  clearExecutions() { return executionRepo.clearExecutions(this.db); }

  createApproval(params: { executionId: string; actionIds: string[]; reason: string; payload?: unknown }) {
    return approvalRepo.createApproval(this.db, params);
  }
  resolveApproval(id: string, approved: boolean) { approvalRepo.resolveApproval(this.db, id, approved); }
  rejectPendingApproval(id: string) { return approvalRepo.rejectPendingApproval(this.db, id); }
  failApproval(id: string) { return approvalRepo.failApproval(this.db, id); }
  claimApproval(id: string) { return approvalRepo.claimApproval(this.db, id); }
  updateApprovalPayload(id: string, extra: Record<string, unknown>) {
    approvalRepo.updateApprovalPayload(this.db, id, extra);
  }
  getApproval(id: string) { return approvalRepo.getApproval(this.db, id); }
  getPendingApprovals() { return approvalRepo.getPendingApprovals(this.db); }
  getPendingApprovalsWithExecutionSnapshots() {
    return approvalRepo.getPendingApprovalsWithExecutionSnapshots(this.db);
  }

  getSetting<T>(key: string, defaultValue: T): T { return settingsRepo.getSetting(this.db, key, defaultValue); }
  listSettingsByPrefix(prefix: string) { return settingsRepo.listSettingsByPrefix(this.db, prefix); }
  getGlobalActive(): boolean { return settingsRepo.getGlobalActive(this.db); }
  setSetting(key: string, value: unknown) { settingsRepo.setSetting(this.db, key, value); }
  deleteSetting(key: string) { settingsRepo.deleteSetting(this.db, key); }
  setConnection(connector: string, connected: boolean, config?: Record<string, unknown>) {
    settingsRepo.setConnection(this.db, connector, connected, config);
    this.connectionRevision++;
  }
  getConnectionRevision() { return this.connectionRevision; }
  getConnections() { return settingsRepo.getConnections(this.db); }

  getDiscoveryMetadata(assetId: string): DiscoveryMetadataRecord | undefined {
    return discoveryMetadata.getDiscoveryMetadata(this.db, assetId);
  }
  listDiscoveryMetadata(): DiscoveryMetadataRecord[] {
    return discoveryMetadata.listDiscoveryMetadata(this.db);
  }
  upsertDiscoveryMetadata(input: DiscoveryMetadataInput): DiscoveryMetadataRecord {
    return discoveryMetadata.upsertDiscoveryMetadata(this.db, input);
  }
  deleteDiscoveryMetadata(assetId: string): boolean {
    return discoveryMetadata.deleteDiscoveryMetadata(this.db, assetId);
  }

  claimTriggerReceipt(params: {
    dedupeKey: string;
    workflowId: string;
    triggerType: string;
    processingLeaseMs?: number;
  }) {
    return triggerReceiptRepo.claimTriggerReceipt(this.db, params);
  }
  completeTriggerReceipt(dedupeKey: string, executionId?: string) {
    triggerReceiptRepo.completeTriggerReceipt(this.db, dedupeKey, executionId);
  }
  failTriggerReceipt(dedupeKey: string) { triggerReceiptRepo.failTriggerReceipt(this.db, dedupeKey); }
  isTriggerReceiptCompleted(dedupeKey: string) {
    return triggerReceiptRepo.isTriggerReceiptCompleted(this.db, dedupeKey);
  }

  saveDiscoverySession(state: DiscoverySessionState) {
    const existing = discoveryRepo.getDiscoverySession(this.db, state.id);
    if (existing) {
      discoveryRepo.updateDiscoverySession(this.db, state);
      return;
    }
    discoveryRepo.insertDiscoverySession(this.db, state);
  }
  getDiscoverySessionState(id: string) { return discoveryRepo.getDiscoverySession(this.db, id); }
  listDiscoverySessions() { return discoveryRepo.listDiscoverySessions(this.db); }
  insertDiscoveryExample(params: {
    sessionId: string;
    label?: string;
    outputArtifactIds: string[];
    inputArtifactIds: string[];
    observationsJson?: string;
  }) {
    return discoveryRepo.insertDiscoveryExample(this.db, params);
  }
  listDiscoveryExamples(sessionId: string) { return discoveryRepo.listDiscoveryExamples(this.db, sessionId); }
  insertDiscoverySnapshot(snapshot: discoveryRepo.DiscoverySnapshotRecord & { table?: TableArtifact }) {
    const { table: _table, ...record } = snapshot;
    return discoveryRepo.insertDiscoverySnapshot(this.db, record);
  }
  upsertDiscoverySnapshot(snapshot: discoveryRepo.DiscoverySnapshotRecord & { table?: TableArtifact }) {
    const { table: _table, ...record } = snapshot;
    return discoveryRepo.upsertDiscoverySnapshot(this.db, record);
  }
  listDiscoverySnapshots(sessionId: string) {
    return discoveryRepo.listDiscoverySnapshots(this.db, sessionId);
  }
  upsertDiscoveryReplayCase(replayCase: discoveryRepo.DiscoveryReplayCaseRecord) {
    return discoveryRepo.upsertDiscoveryReplayCase(this.db, replayCase);
  }
  listDiscoveryReplayCases(sessionId: string) {
    return discoveryRepo.listDiscoveryReplayCases(this.db, sessionId);
  }

  createRepairProposal(params: {
    workflowId: string;
    baseVersion: number;
    candidates: RepairCandidateOperation[];
  }) {
    return repairRepo.createWorkflowRepairProposal(this.db, params);
  }
  getRepairProposal(id: string) { return repairRepo.getWorkflowRepairProposal(this.db, id); }
  listRepairProposals(options: { workflowId?: string; status?: RepairProposal['status'] } = {}) {
    return repairRepo.listWorkflowRepairProposals(this.db, options);
  }
  updateRepairProposalReplay(id: string, replay: RepairReplaySummary) {
    return repairRepo.updateWorkflowRepairProposalReplay(this.db, id, replay);
  }
  updateRepairProposal(
    id: string,
    patch: { status: RepairProposal['status']; appliedVersion?: number; rejectionReason?: string },
  ) {
    return repairRepo.updateWorkflowRepairProposal(this.db, id, patch);
  }
}
