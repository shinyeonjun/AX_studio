import type { AppDatabase } from './db.js';
import type { WorkflowIR } from '../workflow/schema.js';
import type { ExecutionStatus } from './rows.js';
import * as workflowRepo from './repositories/workflow-repository.js';
import * as executionRepo from './repositories/execution-repository.js';
import * as approvalRepo from './repositories/approval-repository.js';
import * as settingsRepo from './repositories/settings-repository.js';
import * as workspaceChatRepo from './repositories/workspace-chat-repository.js';
import * as triggerReceiptRepo from './repositories/trigger-receipt-repository.js';
import * as discoveryRepo from './repositories/work-discovery-repository.js';
import type { DiscoverySessionState } from '../work-discovery/schema.js';
import * as workspaceSourceRepo from './repositories/workspace-source-repository.js';

export class WorkflowStore {
  constructor(private db: AppDatabase) {}

  saveWorkflow(ir: WorkflowIR) {
    return workflowRepo.saveWorkflow(this.db, ir);
  }

  getWorkflow(workflowId: string, version?: number) {
    return workflowRepo.getWorkflow(this.db, workflowId, version);
  }

  getWorkflowPolicy(workflowId: string) {
    return workflowRepo.getWorkflowPolicy(this.db, workflowId);
  }

  updateWorkflowPolicy(workflowId: string, patch: import('../agent/scoped-context.js').AgentScopedContextPatch) {
    return workflowRepo.updateWorkflowPolicy(this.db, workflowId, patch);
  }

  listWorkflows() {
    return workflowRepo.listWorkflows(this.db);
  }

  setWorkflowActive(workflowId: string, active: boolean) {
    return workflowRepo.setWorkflowActive(this.db, workflowId, active);
  }

  deleteWorkflow(workflowId: string) {
    return workflowRepo.deleteWorkflow(this.db, workflowId);
  }

  saveWorkspaceChat(params: {
    id?: string;
    messages: workspaceChatRepo.WorkspaceChatMessage[];
    workflowId?: string | null;
  }) {
    return workspaceChatRepo.saveWorkspaceChat(this.db, params);
  }

  getWorkspaceChat(id: string) {
    return workspaceChatRepo.getWorkspaceChat(this.db, id);
  }

  getWorkspaceChatMemo(sessionId: string) {
    return workspaceChatRepo.getWorkspaceChatMemo(this.db, sessionId);
  }

  updateWorkspaceChatMemo(sessionId: string, patch: import('../agent/scoped-context.js').AgentScopedContextPatch) {
    return workspaceChatRepo.updateWorkspaceChatMemo(this.db, sessionId, patch);
  }

  getWorkspaceChatByWorkflowId(workflowId: string) {
    return workspaceChatRepo.getWorkspaceChatByWorkflowId(this.db, workflowId);
  }

  listWorkspaceChats(limit = 50) {
    return workspaceChatRepo.listWorkspaceChats(this.db, limit);
  }

  deleteWorkspaceChat(id: string) {
    workspaceChatRepo.deleteWorkspaceChat(this.db, id);
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

  countWorkspaceSourcesForArtifact(artifactId: string, excludeSessionId: string) {
    return workspaceSourceRepo.countWorkspaceSourcesForArtifact(this.db, artifactId, excludeSessionId);
  }

  refreshWorkspaceChatTitle(sessionId: string) {
    return workspaceChatRepo.refreshWorkspaceChatTitle(this.db, sessionId);
  }

  createExecution(params: {
    workflowId?: string;
    workflowVersion?: number;
    ephemeral: boolean;
    triggerType?: string;
    irJson?: string;
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

  updateExecutionLog(id: string, log: unknown[]) {
    executionRepo.updateExecutionLog(this.db, id, log);
  }

  getExecution(id: string) {
    return executionRepo.getExecution(this.db, id);
  }

  listExecutions(limit = 50) {
    return executionRepo.listExecutions(this.db, limit);
  }

  deleteExecution(id: string) {
    return executionRepo.deleteExecution(this.db, id);
  }

  clearExecutions() {
    return executionRepo.clearExecutions(this.db);
  }

  createApproval(params: { executionId: string; actionIds: string[]; reason: string; payload?: unknown }) {
    return approvalRepo.createApproval(this.db, params);
  }

  resolveApproval(id: string, approved: boolean) {
    approvalRepo.resolveApproval(this.db, id, approved);
  }

  rejectPendingApproval(id: string) {
    return approvalRepo.rejectPendingApproval(this.db, id);
  }

  failApproval(id: string) {
    return approvalRepo.failApproval(this.db, id);
  }

  claimApproval(id: string) {
    return approvalRepo.claimApproval(this.db, id);
  }

  updateApprovalPayload(id: string, extra: Record<string, unknown>) {
    approvalRepo.updateApprovalPayload(this.db, id, extra);
  }

  getApproval(id: string) {
    return approvalRepo.getApproval(this.db, id);
  }

  getPendingApprovals() {
    return approvalRepo.getPendingApprovals(this.db);
  }

  getSetting<T>(key: string, defaultValue: T): T {
    return settingsRepo.getSetting(this.db, key, defaultValue);
  }

  getGlobalActive(): boolean {
    return settingsRepo.getGlobalActive(this.db);
  }

  setSetting(key: string, value: unknown) {
    settingsRepo.setSetting(this.db, key, value);
  }

  setConnection(connector: string, connected: boolean, config?: Record<string, unknown>) {
    settingsRepo.setConnection(this.db, connector, connected, config);
  }

  getConnections() {
    return settingsRepo.getConnections(this.db);
  }

  claimTriggerReceipt(params: { dedupeKey: string; workflowId: string; triggerType: string }) {
    return triggerReceiptRepo.claimTriggerReceipt(this.db, params);
  }

  completeTriggerReceipt(dedupeKey: string, executionId?: string) {
    triggerReceiptRepo.completeTriggerReceipt(this.db, dedupeKey, executionId);
  }

  failTriggerReceipt(dedupeKey: string) {
    triggerReceiptRepo.failTriggerReceipt(this.db, dedupeKey);
  }

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

  getDiscoverySessionState(id: string) {
    return discoveryRepo.getDiscoverySession(this.db, id);
  }

  listDiscoverySessions() {
    return discoveryRepo.listDiscoverySessions(this.db);
  }

  insertDiscoveryExample(params: {
    sessionId: string;
    label?: string;
    outputArtifactIds: string[];
    inputArtifactIds: string[];
    observationsJson?: string;
  }) {
    return discoveryRepo.insertDiscoveryExample(this.db, params);
  }

  listDiscoveryExamples(sessionId: string) {
    return discoveryRepo.listDiscoveryExamples(this.db, sessionId);
  }

  insertDiscoverySnapshot(snapshot: discoveryRepo.DiscoverySnapshotRecord & { table?: import('../contracts/artifacts/table.js').TableArtifact }) {
    const { table: _table, ...record } = snapshot;
    return discoveryRepo.insertDiscoverySnapshot(this.db, record);
  }

  upsertDiscoverySnapshot(snapshot: discoveryRepo.DiscoverySnapshotRecord & { table?: import('../contracts/artifacts/table.js').TableArtifact }) {
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
}
