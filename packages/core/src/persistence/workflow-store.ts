import type { AppDatabase } from './db.js';
import type { AgentScopedContextPatch } from '../intelligence/agent/scoped-context.js';
import type { TableArtifact } from '../contracts/artifacts/table.js';
import type { ToolSendOutcome } from '../contracts/tool-result.js';
import type { DiscoverySessionState } from '../work-discovery/schema.js';
import type { WorkflowIR } from '../workflow/schema.js';
import type { ExecutionStatus } from './rows.js';
import type { RepairCandidateOperation, RepairProposal, RepairReplaySummary } from '../workflow/repair.js';
import * as discoveryRepo from './repositories/work-discovery-repository.js';
import * as workspaceChatRepo from './repositories/workspace-chat-repository.js';
import * as workspaceSourceRepo from './repositories/workspace-source-repository.js';
import type { DiscoveryMetadataInput, DiscoveryMetadataRecord } from '../contracts/discovery-metadata.js';
import { ChatHostStateMap } from './chat-host-state.js';
import * as retentionRepo from './repositories/retention-repository.js';
import { type ColumnLabels } from '../contracts/artifacts/column-labels.js';
import { type SourceChoice } from '../contracts/source-choices.js';
import { WorkflowDefinitionStore } from './stores/workflow-definition-store.js';
import { WorkspaceChatStore } from './stores/workspace-chat-store.js';
import { ExecutionStore } from './stores/execution-store.js';
import { ApprovalStore } from './stores/approval-store.js';
import { TriggerReceiptStore } from './stores/trigger-receipt-store.js';
import { SettingsStore } from './stores/settings-store.js';
import { DiscoveryStore } from './stores/discovery-store.js';
import { RepairStore } from './stores/repair-store.js';
import { UsageStore } from './stores/usage-store.js';

export class WorkflowStore {
  readonly workflows: WorkflowDefinitionStore;
  readonly chat: WorkspaceChatStore;
  readonly executions: ExecutionStore;
  readonly approvals: ApprovalStore;
  readonly triggers: TriggerReceiptStore;
  readonly settings: SettingsStore;
  readonly discovery: DiscoveryStore;
  readonly repairs: RepairStore;
  readonly usage: UsageStore;

  constructor(db: AppDatabase) {
    this.workflows = new WorkflowDefinitionStore(db);
    this.chat = new WorkspaceChatStore(db);
    this.executions = new ExecutionStore(db);
    this.approvals = new ApprovalStore(db);
    this.triggers = new TriggerReceiptStore(db);
    this.settings = new SettingsStore(db);
    this.discovery = new DiscoveryStore(db);
    this.repairs = new RepairStore(db);
    this.usage = new UsageStore(db);
  }

  saveWorkflow(ir: WorkflowIR) { return this.workflows.saveWorkflow(ir); }

  claimWorkflowDeletion(workflowId: string, expectedVersion: number): boolean {
    return this.workflows.claimWorkflowDeletion(workflowId, expectedVersion);
  }

  workflowExists(workflowId: string): boolean { return this.workflows.workflowExists(workflowId); }

  /**
   * Deletion claim for a workflow whose stored definition cannot be read (corrupt latest
   * version JSON, or a workflow row without any version). It never applies to a readable
   * workflow, which must use the version-checked claimWorkflowDeletion. The repository
   * delete still refuses while an execution is running or awaiting approval.
   */
  claimUnreadableWorkflowDeletion(workflowId: string): boolean {
    return this.workflows.claimUnreadableWorkflowDeletion(workflowId);
  }

  releaseWorkflowDeletion(workflowId: string): void {
    return this.workflows.releaseWorkflowDeletion(workflowId);
  }

  getWorkflow(workflowId: string, version?: number) {
    return this.workflows.getWorkflow(workflowId, version);
  }

  getWorkflowPolicy(workflowId: string) { return this.workflows.getWorkflowPolicy(workflowId); }

  updateWorkflowPolicy(workflowId: string, patch: AgentScopedContextPatch) {
    return this.workflows.updateWorkflowPolicy(workflowId, patch);
  }

  listWorkflows() { return this.workflows.listWorkflows(); }

  listWorkflowDefinitions() { return this.workflows.listWorkflowDefinitions(); }

  listActiveWorkflowDefinitions() { return this.workflows.listActiveWorkflowDefinitions(); }

  isWorkflowActive(workflowId: string) { return this.workflows.isWorkflowActive(workflowId); }

  workflowActiveState(workflowId: string) { return this.workflows.workflowActiveState(workflowId); }

  setWorkflowActive(workflowId: string, active: boolean) {
    return this.workflows.setWorkflowActive(workflowId, active);
  }

  deleteWorkflow(workflowId: string, options?: { deleteHistory?: boolean }) {
    return this.workflows.deleteWorkflow(workflowId, options);
  }

  saveWorkspaceChat(params: {
    id?: string;
    messages: workspaceChatRepo.WorkspaceChatMessage[];
    workflowId?: string | null;
    expectedTranscriptRevision?: string;
    registeredMetadataParticipation?: boolean;
  }) {
    return this.chat.saveWorkspaceChat(params);
  }

  appendWorkspaceChatMetadataReply(input: Parameters<typeof workspaceChatRepo.appendWorkspaceChatMetadataReply>[1]) {
    return this.chat.appendWorkspaceChatMetadataReply(input);
  }

  upsertWorkspaceChatExecutionResult(
    target: string | { workflowId: string },
    message: workspaceChatRepo.WorkspaceChatMessage & { kind: 'execution_result'; executionId: string },
    options?: { collapseSuccessiveRunsOf?: string },
  ) {
    return this.chat.upsertWorkspaceChatExecutionResult(target, message, options);
  }

  getWorkspaceChat(id: string) { return this.chat.getWorkspaceChat(id); }

  hasWorkspaceChat(id: string): boolean { return this.chat.hasWorkspaceChat(id); }

  onWorkspaceChatDeleted(observer: (id: string) => void): () => void {
    return this.chat.onWorkspaceChatDeleted(observer);
  }

  getWorkspaceChatMemo(sessionId: string) { return this.chat.getWorkspaceChatMemo(sessionId); }

  updateWorkspaceChatMemo(sessionId: string, patch: AgentScopedContextPatch) {
    return this.chat.updateWorkspaceChatMemo(sessionId, patch);
  }

  getWorkspaceChatByWorkflowId(workflowId: string) {
    return this.chat.getWorkspaceChatByWorkflowId(workflowId);
  }

  listWorkspaceChats(limit = 50) { return this.chat.listWorkspaceChats(limit); }

  deleteWorkspaceChat(id: string) { return this.chat.deleteWorkspaceChat(id); }

  refreshWorkspaceChatTitle(sessionId: string) { return this.chat.refreshWorkspaceChatTitle(sessionId); }

  insertWorkspaceSource(record: workspaceSourceRepo.WorkspaceSourceRecord) {
    return this.chat.insertWorkspaceSource(record);
  }

  updateWorkspaceSource(
    id: string,
    patch: Partial<Omit<workspaceSourceRepo.WorkspaceSourceRecord, 'id' | 'sessionId' | 'artifactId' | 'fileName' | 'createdAt'>>,
  ) {
    return this.chat.updateWorkspaceSource(id, patch);
  }

  getWorkspaceSource(sessionId: string, id: string) { return this.chat.getWorkspaceSource(sessionId, id); }

  listWorkspaceSources(sessionId: string) { return this.chat.listWorkspaceSources(sessionId); }

  listProcessingWorkspaceSources() { return this.chat.listProcessingWorkspaceSources(); }

  countWorkspaceSourcesForArtifact(artifactId: string, excludeSessionId: string) {
    return this.chat.countWorkspaceSourcesForArtifact(artifactId, excludeSessionId);
  }

  findReferencedWorkspaceSourceArtifacts(artifactIds: readonly string[], excludeSessionId: string) {
    return this.chat.findReferencedWorkspaceSourceArtifacts(artifactIds, excludeSessionId);
  }

  createExecution(params: {
    workflowId?: string;
    workflowVersion?: number;
    ephemeral: boolean;
    triggerType?: string;
    irJson?: string;
    workspaceSessionId?: string;
  }) {
    return this.executions.createExecution(params);
  }

  finishExecution(
    id: string,
    status: Exclude<ExecutionStatus, 'running' | 'pending_approval'>,
    errorCode?: string,
    log?: unknown[],
    options?: { preserveHistory?: boolean },
  ) {
    return this.executions.finishExecution(id, status, errorCode, log, options);
  }

  markExecutionPending(id: string, errorCode = 'pending_approval', log?: unknown[]) {
    return this.executions.markExecutionPending(id, errorCode, log);
  }

  updateExecutionLog(id: string, log: unknown[]) { return this.executions.updateExecutionLog(id, log); }

  appendExecutionLog(id: string, entries: readonly unknown[]) {
    return this.executions.appendExecutionLog(id, entries);
  }

  /** Bounded history retention; never touches active/pending executions or open approvals. */
  pruneHistory(policy?: retentionRepo.HistoryRetentionPolicy, now?: Date) {
    return this.executions.pruneHistory(policy, now);
  }

  /** Rows skipped by tolerant list reads (ids and error codes only). */
  listCorruptRows() { return this.executions.listCorruptRows(); }

  hasPendingApprovalForWorkflow(workflowId: string) {
    return this.executions.hasPendingApprovalForWorkflow(workflowId);
  }

  getExecution(id: string) { return this.executions.getExecution(id); }

  listUnfinishedExecutions() { return this.executions.listUnfinishedExecutions(); }

  getExecutionOutput(id: string) { return this.executions.getExecutionOutput(id); }

  listExecutions(limit = 50, includeOutput = false) {
    return this.executions.listExecutions(limit, includeOutput);
  }

  deleteExecution(id: string) { return this.executions.deleteExecution(id); }

  clearExecutions() { return this.executions.clearExecutions(); }

  createApproval(params: { executionId: string; actionIds: string[]; reason: string; payload?: unknown }) {
    return this.approvals.createApproval(params);
  }

  resolveApproval(id: string, approved: boolean) { return this.approvals.resolveApproval(id, approved); }

  rejectPendingApproval(id: string) { return this.approvals.rejectPendingApproval(id); }

  failApproval(id: string) { return this.approvals.failApproval(id); }

  claimApproval(id: string, intent?: Pick<ToolSendOutcome, 'binding' | 'paramsHash'>) {
    return this.approvals.claimApproval(id, intent);
  }

  updateApprovalPayload(id: string, extra: Record<string, unknown>) {
    return this.approvals.updateApprovalPayload(id, extra);
  }

  getApproval(id: string) { return this.approvals.getApproval(id); }

  getPendingApprovals() { return this.approvals.getPendingApprovals(); }

  getProcessingApprovals() { return this.approvals.getProcessingApprovals(); }

  getApprovalRecoveryCandidates() { return this.approvals.getApprovalRecoveryCandidates(); }

  getPendingApprovalsWithExecutionSnapshots() {
    return this.approvals.getPendingApprovalsWithExecutionSnapshots();
  }

  claimTriggerReceipt(params: {
    dedupeKey: string;
    workflowId: string;
    triggerType: string;
    processingLeaseMs?: number;
  }) {
    return this.triggers.claimTriggerReceipt(params);
  }

  completeTriggerReceipt(dedupeKey: string, executionId?: string) {
    return this.triggers.completeTriggerReceipt(dedupeKey, executionId);
  }

  failTriggerReceipt(dedupeKey: string) { return this.triggers.failTriggerReceipt(dedupeKey); }

  deadLetterTriggerReceipt(dedupeKey: string, executionId?: string) {
    return this.triggers.deadLetterTriggerReceipt(dedupeKey, executionId);
  }

  deadLetterProcessingTriggerReceipts() { return this.triggers.deadLetterProcessingTriggerReceipts(); }

  isTriggerReceiptCompleted(dedupeKey: string) { return this.triggers.isTriggerReceiptCompleted(dedupeKey); }

  /** Host-only state of one kind, per conversation, that survives a restart. */
  chatHostState<T>(kind: string, maxEntries?: number): ChatHostStateMap<T> {
    return this.settings.chatHostState<T>(kind, maxEntries);
  }

  getSetting<T>(key: string, defaultValue: T): T { return this.settings.getSetting<T>(key, defaultValue); }

  listSettingsByPrefix(prefix: string) { return this.settings.listSettingsByPrefix(prefix); }

  getGlobalActive(): boolean { return this.settings.getGlobalActive(); }

  setSetting(key: string, value: unknown) { return this.settings.setSetting(key, value); }

  deleteSetting(key: string) { return this.settings.deleteSetting(key); }

  /** Korean headers learned for column names, shared by chat answers and run results. */
  getColumnLabels(): ColumnLabels { return this.settings.getColumnLabels(); }

  /** Places the person picked when a request fitted several; background for later routing. */
  getSourceChoices(): SourceChoice[] { return this.settings.getSourceChoices(); }

  rememberSourceChoice(choice: SourceChoice) { return this.settings.rememberSourceChoice(choice); }

  /** Column names the AI was asked to label and could not; they are not asked about again. */
  getUnlabelledColumns(): string[] { return this.settings.getUnlabelledColumns(); }

  rememberColumnLabels(labels: ColumnLabels, unlabelled: readonly string[] = []) {
    return this.settings.rememberColumnLabels(labels, unlabelled);
  }

  setConnection(connector: string, connected: boolean, config?: Record<string, unknown>) {
    return this.settings.setConnection(connector, connected, config);
  }

  getConnectionRevision() { return this.settings.getConnectionRevision(); }

  getConnections(options?: { suppressCorruptDiagnostics?: boolean }) {
    return this.settings.getConnections(options);
  }

  getDiscoveryMetadata(assetId: string): DiscoveryMetadataRecord | undefined {
    return this.discovery.getDiscoveryMetadata(assetId);
  }

  listDiscoveryMetadata(): DiscoveryMetadataRecord[] { return this.discovery.listDiscoveryMetadata(); }

  upsertDiscoveryMetadata(input: DiscoveryMetadataInput): DiscoveryMetadataRecord {
    return this.discovery.upsertDiscoveryMetadata(input);
  }

  deleteDiscoveryMetadata(assetId: string): boolean {
    return this.discovery.deleteDiscoveryMetadata(assetId);
  }

  getDiscoveryMetadataRevision() { return this.discovery.getDiscoveryMetadataRevision(); }

  /** Pass `expectedRevision` (the revision the caller read) for a strict compare-and-swap. */
  saveDiscoverySession(state: DiscoverySessionState, expectedRevision?: number) {
    return this.discovery.saveDiscoverySession(state, expectedRevision);
  }

  getDiscoverySessionState(id: string) { return this.discovery.getDiscoverySessionState(id); }

  bindDiscoverySessionWorkspace(sessionId: string, workspaceSessionId: string) {
    return this.discovery.bindDiscoverySessionWorkspace(sessionId, workspaceSessionId);
  }

  getDiscoverySessionWorkspace(sessionId: string) {
    return this.discovery.getDiscoverySessionWorkspace(sessionId);
  }

  listDiscoverySessions() { return this.discovery.listDiscoverySessions(); }

  listDiscoverySessionIds() { return this.discovery.listDiscoverySessionIds(); }

  insertDiscoveryExample(params: {
    sessionId: string;
    label?: string;
    outputArtifactIds: string[];
    inputArtifactIds: string[];
    observationsJson?: string;
  }) {
    return this.discovery.insertDiscoveryExample(params);
  }

  listDiscoveryExamples(sessionId: string) { return this.discovery.listDiscoveryExamples(sessionId); }

  insertDiscoverySnapshot(snapshot: discoveryRepo.DiscoverySnapshotRecord & { table?: TableArtifact }) {
    return this.discovery.insertDiscoverySnapshot(snapshot);
  }

  upsertDiscoverySnapshot(snapshot: discoveryRepo.DiscoverySnapshotRecord & { table?: TableArtifact }) {
    return this.discovery.upsertDiscoverySnapshot(snapshot);
  }

  listDiscoverySnapshots(sessionId: string) { return this.discovery.listDiscoverySnapshots(sessionId); }

  upsertDiscoveryReplayCase(replayCase: discoveryRepo.DiscoveryReplayCaseRecord) {
    return this.discovery.upsertDiscoveryReplayCase(replayCase);
  }

  listDiscoveryReplayCases(sessionId: string) { return this.discovery.listDiscoveryReplayCases(sessionId); }

  createRepairProposal(params: {
    workflowId: string;
    baseVersion: number;
    candidates: RepairCandidateOperation[];
  }) {
    return this.repairs.createRepairProposal(params);
  }

  getRepairProposal(id: string) { return this.repairs.getRepairProposal(id); }

  listRepairProposals(options: { workflowId?: string; status?: RepairProposal['status'] } = {}) {
    return this.repairs.listRepairProposals(options);
  }

  updateRepairProposalReplay(id: string, replay: RepairReplaySummary) {
    return this.repairs.updateRepairProposalReplay(id, replay);
  }

  updateRepairProposal(
    id: string,
    patch: { status: RepairProposal['status']; appliedVersion?: number; rejectionReason?: string },
  ) {
    return this.repairs.updateRepairProposal(id, patch);
  }
}
