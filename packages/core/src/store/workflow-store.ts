import type { AppDatabase } from './db.js';
import type { AgentScopedContextPatch } from '../agent/scoped-context.js';
import type { TableArtifact } from '../contracts/artifacts/table.js';
import type { DiscoverySessionState } from '../work-discovery/schema.js';
import type { WorkflowIR } from '../workflow/schema.js';
import type { ExecutionStatus } from './rows.js';
import type {
  RepairCandidateOperation,
  RepairProposal,
  RepairReplaySummary,
} from '../workflow/repair.js';
import type * as discoveryRepo from './repositories/work-discovery-repository.js';
import type * as workspaceChatRepo from './repositories/workspace-chat-repository.js';
import type * as workspaceSourceRepo from './repositories/workspace-source-repository.js';
import * as approvals from './workflow-store/approvals.js';
import * as discovery from './workflow-store/discovery.js';
import * as executions from './workflow-store/executions.js';
import * as repairs from './workflow-store/repairs.js';
import * as settings from './workflow-store/settings.js';
import * as triggers from './workflow-store/triggers.js';
import * as workflows from './workflow-store/workflows.js';
import * as workspaces from './workflow-store/workspaces.js';

export class WorkflowStore {
  constructor(private db: AppDatabase) {}

  saveWorkflow(ir: WorkflowIR) { return workflows.saveWorkflow(this.db, ir); }
  getWorkflow(workflowId: string, version?: number) { return workflows.getWorkflow(this.db, workflowId, version); }
  getWorkflowPolicy(workflowId: string) { return workflows.getWorkflowPolicy(this.db, workflowId); }
  updateWorkflowPolicy(workflowId: string, patch: AgentScopedContextPatch) {
    return workflows.updateWorkflowPolicy(this.db, workflowId, patch);
  }
  listWorkflows() { return workflows.listWorkflows(this.db); }
  setWorkflowActive(workflowId: string, active: boolean) {
    return workflows.setWorkflowActive(this.db, workflowId, active);
  }
  deleteWorkflow(workflowId: string) { return workflows.deleteWorkflow(this.db, workflowId); }

  saveWorkspaceChat(params: {
    id?: string;
    messages: workspaceChatRepo.WorkspaceChatMessage[];
    workflowId?: string | null;
  }) {
    return workspaces.saveWorkspaceChat(this.db, params);
  }
  upsertWorkspaceChatExecutionResult(
    sessionId: string,
    message: workspaceChatRepo.WorkspaceChatMessage & { kind: 'execution_result'; executionId: string },
  ) {
    return workspaces.upsertWorkspaceChatExecutionResult(this.db, sessionId, message);
  }
  getWorkspaceChat(id: string) { return workspaces.getWorkspaceChat(this.db, id); }
  getWorkspaceChatMemo(sessionId: string) { return workspaces.getWorkspaceChatMemo(this.db, sessionId); }
  updateWorkspaceChatMemo(sessionId: string, patch: AgentScopedContextPatch) {
    return workspaces.updateWorkspaceChatMemo(this.db, sessionId, patch);
  }
  getWorkspaceChatByWorkflowId(workflowId: string) {
    return workspaces.getWorkspaceChatByWorkflowId(this.db, workflowId);
  }
  listWorkspaceChats(limit = 50) { return workspaces.listWorkspaceChats(this.db, limit); }
  deleteWorkspaceChat(id: string) { workspaces.deleteWorkspaceChat(this.db, id); }
  refreshWorkspaceChatTitle(sessionId: string) {
    return workspaces.refreshWorkspaceChatTitle(this.db, sessionId);
  }
  insertWorkspaceSource(record: workspaceSourceRepo.WorkspaceSourceRecord) {
    return workspaces.insertWorkspaceSource(this.db, record);
  }
  updateWorkspaceSource(
    id: string,
    patch: Partial<Omit<workspaceSourceRepo.WorkspaceSourceRecord, 'id' | 'sessionId' | 'artifactId' | 'fileName' | 'createdAt'>>,
  ) {
    return workspaces.updateWorkspaceSource(this.db, id, patch);
  }
  getWorkspaceSource(sessionId: string, id: string) {
    return workspaces.getWorkspaceSource(this.db, sessionId, id);
  }
  listWorkspaceSources(sessionId: string) {
    return workspaces.listWorkspaceSources(this.db, sessionId);
  }
  countWorkspaceSourcesForArtifact(artifactId: string, excludeSessionId: string) {
    return workspaces.countWorkspaceSourcesForArtifact(this.db, artifactId, excludeSessionId);
  }

  createExecution(params: {
    workflowId?: string;
    workflowVersion?: number;
    ephemeral: boolean;
    triggerType?: string;
    irJson?: string;
    workspaceSessionId?: string;
  }) {
    return executions.createExecution(this.db, params);
  }
  finishExecution(
    id: string,
    status: Exclude<ExecutionStatus, 'running' | 'pending_approval'>,
    errorCode?: string,
    log?: unknown[],
  ) {
    executions.finishExecution(this.db, id, status, errorCode, log);
  }
  markExecutionPending(id: string, errorCode = 'pending_approval', log?: unknown[]) {
    executions.markExecutionPending(this.db, id, errorCode, log);
  }
  updateExecutionLog(id: string, log: unknown[]) { executions.updateExecutionLog(this.db, id, log); }
  getExecution(id: string) { return executions.getExecution(this.db, id); }
  listExecutions(limit = 50) { return executions.listExecutions(this.db, limit); }
  deleteExecution(id: string) { return executions.deleteExecution(this.db, id); }
  clearExecutions() { return executions.clearExecutions(this.db); }

  createApproval(params: { executionId: string; actionIds: string[]; reason: string; payload?: unknown }) {
    return approvals.createApproval(this.db, params);
  }
  resolveApproval(id: string, approved: boolean) { approvals.resolveApproval(this.db, id, approved); }
  rejectPendingApproval(id: string) { return approvals.rejectPendingApproval(this.db, id); }
  failApproval(id: string) { return approvals.failApproval(this.db, id); }
  claimApproval(id: string) { return approvals.claimApproval(this.db, id); }
  updateApprovalPayload(id: string, extra: Record<string, unknown>) {
    approvals.updateApprovalPayload(this.db, id, extra);
  }
  getApproval(id: string) { return approvals.getApproval(this.db, id); }
  getPendingApprovals() { return approvals.getPendingApprovals(this.db); }

  getSetting<T>(key: string, defaultValue: T): T { return settings.getSetting(this.db, key, defaultValue); }
  getGlobalActive(): boolean { return settings.getGlobalActive(this.db); }
  setSetting(key: string, value: unknown) { settings.setSetting(this.db, key, value); }
  setConnection(connector: string, connected: boolean, config?: Record<string, unknown>) {
    settings.setConnection(this.db, connector, connected, config);
  }
  getConnections() { return settings.getConnections(this.db); }

  claimTriggerReceipt(params: {
    dedupeKey: string;
    workflowId: string;
    triggerType: string;
    processingLeaseMs?: number;
  }) {
    return triggers.claimTriggerReceipt(this.db, params);
  }
  completeTriggerReceipt(dedupeKey: string, executionId?: string) {
    triggers.completeTriggerReceipt(this.db, dedupeKey, executionId);
  }
  failTriggerReceipt(dedupeKey: string) { triggers.failTriggerReceipt(this.db, dedupeKey); }
  isTriggerReceiptCompleted(dedupeKey: string) {
    return triggers.isTriggerReceiptCompleted(this.db, dedupeKey);
  }

  saveDiscoverySession(state: DiscoverySessionState) { discovery.saveDiscoverySession(this.db, state); }
  getDiscoverySessionState(id: string) { return discovery.getDiscoverySessionState(this.db, id); }
  listDiscoverySessions() { return discovery.listDiscoverySessions(this.db); }
  insertDiscoveryExample(params: {
    sessionId: string;
    label?: string;
    outputArtifactIds: string[];
    inputArtifactIds: string[];
    observationsJson?: string;
  }) {
    return discovery.insertDiscoveryExample(this.db, params);
  }
  listDiscoveryExamples(sessionId: string) { return discovery.listDiscoveryExamples(this.db, sessionId); }
  insertDiscoverySnapshot(snapshot: discoveryRepo.DiscoverySnapshotRecord & { table?: TableArtifact }) {
    return discovery.insertDiscoverySnapshot(this.db, snapshot);
  }
  upsertDiscoverySnapshot(snapshot: discoveryRepo.DiscoverySnapshotRecord & { table?: TableArtifact }) {
    return discovery.upsertDiscoverySnapshot(this.db, snapshot);
  }
  listDiscoverySnapshots(sessionId: string) {
    return discovery.listDiscoverySnapshots(this.db, sessionId);
  }
  upsertDiscoveryReplayCase(replayCase: discoveryRepo.DiscoveryReplayCaseRecord) {
    return discovery.upsertDiscoveryReplayCase(this.db, replayCase);
  }
  listDiscoveryReplayCases(sessionId: string) {
    return discovery.listDiscoveryReplayCases(this.db, sessionId);
  }

  createRepairProposal(params: {
    workflowId: string;
    baseVersion: number;
    candidates: RepairCandidateOperation[];
  }) {
    return repairs.createRepairProposal(this.db, params);
  }
  getRepairProposal(id: string) { return repairs.getRepairProposal(this.db, id); }
  listRepairProposals(options: { workflowId?: string; status?: RepairProposal['status'] } = {}) {
    return repairs.listRepairProposals(this.db, options);
  }
  updateRepairProposalReplay(id: string, replay: RepairReplaySummary) {
    return repairs.updateRepairProposalReplay(this.db, id, replay);
  }
  updateRepairProposal(
    id: string,
    patch: { status: RepairProposal['status']; appliedVersion?: number; rejectionReason?: string },
  ) {
    return repairs.updateRepairProposal(this.db, id, patch);
  }
}
