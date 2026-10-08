import type { AppDatabase } from './db.js';
import type { AgentScopedContextPatch } from '../intelligence/agent/scoped-context.js';
import type { TableArtifact } from '../contracts/artifacts/table.js';
import type { ToolSendOutcome } from '../contracts/tool-result.js';
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
import { ChatHostStateMap } from './chat-host-state.js';
import * as retentionRepo from './repositories/retention-repository.js';
import { listCorruptRows } from './tolerant-rows.js';
import { mergeColumnLabels, validColumnLabel, type ColumnLabels } from '../contracts/artifacts/column-labels.js';
import { mergeSourceChoices, validSourceChoice, type SourceChoice } from '../contracts/source-choices.js';

const COLUMN_LABELS_SETTING = 'column_labels';
const SOURCE_CHOICES_SETTING = 'source_choices';

export class WorkflowStore {
  // Main-process writers share this store; hold the id while async runtime cleanup drains.
  private readonly deletingWorkflowIds = new Set<string>();
  // Invalidates derived catalogs without hashing large persisted connector configs.
  private connectionRevision = 0;
  private readonly sessionDeletionObservers = new Set<(id: string) => void>();
  private discoveryMetadataRevision = 0;

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

  /**
   * Deletion claim for a workflow whose stored definition cannot be read (corrupt latest
   * version JSON, or a workflow row without any version). It never applies to a readable
   * workflow, which must use the version-checked claimWorkflowDeletion. The repository
   * delete still refuses while an execution is running or awaiting approval.
   */
  workflowExists(workflowId: string): boolean {
    return Boolean(this.db.prepare('SELECT 1 FROM workflows WHERE id = ?').get(workflowId));
  }

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

  saveWorkspaceChat(params: {
    id?: string;
    messages: workspaceChatRepo.WorkspaceChatMessage[];
    workflowId?: string | null;
    expectedTranscriptRevision?: string;
    registeredMetadataParticipation?: boolean;
  }) {
    return workspaceChatRepo.saveWorkspaceChat(this.db, params);
  }
  appendWorkspaceChatMetadataReply(input: Parameters<typeof workspaceChatRepo.appendWorkspaceChatMetadataReply>[1]) {
    return workspaceChatRepo.appendWorkspaceChatMetadataReply(this.db, input);
  }
  upsertWorkspaceChatExecutionResult(
    target: string | { workflowId: string },
    message: workspaceChatRepo.WorkspaceChatMessage & { kind: 'execution_result'; executionId: string },
    options?: { collapseSuccessiveRunsOf?: string },
  ) {
    return workspaceChatRepo.upsertWorkspaceChatExecutionResult(this.db, target, message, options);
  }
  getWorkspaceChat(id: string) { return workspaceChatRepo.getWorkspaceChat(this.db, id); }
  hasWorkspaceChat(id: string): boolean {
    return !!this.db.prepare('SELECT 1 FROM workspace_chats WHERE id = ?').get(id);
  }
  onWorkspaceChatDeleted(observer: (id: string) => void): () => void {
    this.sessionDeletionObservers.add(observer);
    return () => { this.sessionDeletionObservers.delete(observer); };
  }
  getWorkspaceChatMemo(sessionId: string) { return workspaceChatRepo.getWorkspaceChatMemo(this.db, sessionId); }
  updateWorkspaceChatMemo(sessionId: string, patch: AgentScopedContextPatch) {
    return workspaceChatRepo.updateWorkspaceChatMemo(this.db, sessionId, patch);
  }
  getWorkspaceChatByWorkflowId(workflowId: string) {
    return workspaceChatRepo.getWorkspaceChatByWorkflowId(this.db, workflowId);
  }
  listWorkspaceChats(limit = 50) { return workspaceChatRepo.listWorkspaceChats(this.db, limit); }
  deleteWorkspaceChat(id: string) {
    // Discard private edits and seals immediately, even if durable deletion fails.
    for (const observer of this.sessionDeletionObservers) observer(id);
    workspaceChatRepo.deleteWorkspaceChat(this.db, id);
  }
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

  createApproval(params: { executionId: string; actionIds: string[]; reason: string; payload?: unknown }) {
    return approvalRepo.createApproval(this.db, params);
  }
  resolveApproval(id: string, approved: boolean) { approvalRepo.resolveApproval(this.db, id, approved); }
  rejectPendingApproval(id: string) { return approvalRepo.rejectPendingApproval(this.db, id); }
  failApproval(id: string) { return approvalRepo.failApproval(this.db, id); }
  claimApproval(id: string, intent?: Pick<ToolSendOutcome, 'binding' | 'paramsHash'>) {
    return approvalRepo.claimApproval(this.db, id, intent);
  }
  updateApprovalPayload(id: string, extra: Record<string, unknown>) {
    approvalRepo.updateApprovalPayload(this.db, id, extra);
  }
  getApproval(id: string) { return approvalRepo.getApproval(this.db, id); }
  getPendingApprovals() { return approvalRepo.getPendingApprovals(this.db); }
  getProcessingApprovals() { return approvalRepo.getProcessingApprovals(this.db); }
  getApprovalRecoveryCandidates() { return approvalRepo.getApprovalRecoveryCandidates(this.db); }
  getPendingApprovalsWithExecutionSnapshots() {
    return approvalRepo.getPendingApprovalsWithExecutionSnapshots(this.db);
  }

  /** Host-only state of one kind, per conversation, that survives a restart. */
  chatHostState<T>(kind: string, maxEntries?: number): ChatHostStateMap<T> {
    return new ChatHostStateMap<T>(this.db, kind, maxEntries);
  }
  getSetting<T>(key: string, defaultValue: T): T { return settingsRepo.getSetting(this.db, key, defaultValue); }
  listSettingsByPrefix(prefix: string) { return settingsRepo.listSettingsByPrefix(this.db, prefix); }
  getGlobalActive(): boolean { return settingsRepo.getGlobalActive(this.db); }
  setSetting(key: string, value: unknown) { settingsRepo.setSetting(this.db, key, value); }
  deleteSetting(key: string) { settingsRepo.deleteSetting(this.db, key); }
  /** Korean headers learned for column names, shared by chat answers and run results. */
  getColumnLabels(): ColumnLabels {
    const stored = settingsRepo.getSetting<unknown>(this.db, COLUMN_LABELS_SETTING, {});
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return {};
    return Object.fromEntries(Object.entries(stored).filter((entry): entry is [string, string] => validColumnLabel(entry[1])));
  }
  /** Places the person picked when a request fitted several; background for later routing. */
  getSourceChoices(): SourceChoice[] {
    const stored = settingsRepo.getSetting<unknown>(this.db, SOURCE_CHOICES_SETTING, []);
    return Array.isArray(stored) ? stored.filter(validSourceChoice) : [];
  }
  rememberSourceChoice(choice: SourceChoice) {
    if (!validSourceChoice(choice)) return;
    settingsRepo.setSetting(this.db, SOURCE_CHOICES_SETTING, mergeSourceChoices(this.getSourceChoices(), choice));
  }
  rememberColumnLabels(labels: ColumnLabels) {
    if (Object.keys(labels).length === 0) return;
    settingsRepo.setSetting(this.db, COLUMN_LABELS_SETTING, mergeColumnLabels(this.getColumnLabels(), labels));
  }
  setConnection(connector: string, connected: boolean, config?: Record<string, unknown>) {
    settingsRepo.setConnection(this.db, connector, connected, config);
    this.connectionRevision++;
  }
  getConnectionRevision() { return this.connectionRevision; }
  getConnections(options?: { suppressCorruptDiagnostics?: boolean }) { return settingsRepo.getConnections(this.db, options); }

  getDiscoveryMetadata(assetId: string): DiscoveryMetadataRecord | undefined {
    return discoveryMetadata.getDiscoveryMetadata(this.db, assetId);
  }
  listDiscoveryMetadata(): DiscoveryMetadataRecord[] {
    return discoveryMetadata.listDiscoveryMetadata(this.db);
  }
  upsertDiscoveryMetadata(input: DiscoveryMetadataInput): DiscoveryMetadataRecord {
    const saved = discoveryMetadata.upsertDiscoveryMetadata(this.db, input);
    this.discoveryMetadataRevision++;
    return saved;
  }
  deleteDiscoveryMetadata(assetId: string): boolean {
    const removed = discoveryMetadata.deleteDiscoveryMetadata(this.db, assetId);
    if (removed) this.discoveryMetadataRevision++;
    return removed;
  }
  getDiscoveryMetadataRevision() { return this.discoveryMetadataRevision; }

  /**
   * Receipts this process claimed and has not settled. The processing lease only exists to recover
   * work a dead process left behind; a run still in progress here (a long run, or one waiting in the
   * run queue) must never be reclaimed by the poll path and run a second time.
   */
  private readonly receiptsInProgress = new Set<string>();

  claimTriggerReceipt(params: {
    dedupeKey: string;
    workflowId: string;
    triggerType: string;
    processingLeaseMs?: number;
  }) {
    if (this.receiptsInProgress.has(params.dedupeKey)) return false;
    const claimed = triggerReceiptRepo.claimTriggerReceipt(this.db, params);
    if (claimed) this.receiptsInProgress.add(params.dedupeKey);
    return claimed;
  }
  completeTriggerReceipt(dedupeKey: string, executionId?: string) {
    triggerReceiptRepo.completeTriggerReceipt(this.db, dedupeKey, executionId);
    this.receiptsInProgress.delete(dedupeKey);
  }
  failTriggerReceipt(dedupeKey: string) {
    triggerReceiptRepo.failTriggerReceipt(this.db, dedupeKey);
    this.receiptsInProgress.delete(dedupeKey);
  }
  deadLetterTriggerReceipt(dedupeKey: string, executionId?: string) {
    triggerReceiptRepo.deadLetterTriggerReceipt(this.db, dedupeKey, executionId);
    this.receiptsInProgress.delete(dedupeKey);
  }
  deadLetterProcessingTriggerReceipts() { return triggerReceiptRepo.deadLetterProcessingTriggerReceipts(this.db); }
  isTriggerReceiptCompleted(dedupeKey: string) {
    return triggerReceiptRepo.isTriggerReceiptCompleted(this.db, dedupeKey);
  }

  /** Pass `expectedRevision` (the revision the caller read) for a strict compare-and-swap. */
  saveDiscoverySession(state: DiscoverySessionState, expectedRevision?: number) {
    // Existence only: a corrupt stored state must still be overwritable by a valid one.
    if (this.db.prepare('SELECT 1 FROM work_discovery_sessions WHERE id = ?').get(state.id)) {
      discoveryRepo.updateDiscoverySession(this.db, state, expectedRevision);
      return;
    }
    discoveryRepo.insertDiscoverySession(this.db, state);
  }
  getDiscoverySessionState(id: string) { return discoveryRepo.getDiscoverySession(this.db, id); }
  bindDiscoverySessionWorkspace(sessionId: string, workspaceSessionId: string) {
    discoveryRepo.bindDiscoverySessionWorkspace(this.db, sessionId, workspaceSessionId);
  }
  getDiscoverySessionWorkspace(sessionId: string) { return discoveryRepo.getDiscoverySessionWorkspace(this.db, sessionId); }
  listDiscoverySessions() { return discoveryRepo.listDiscoverySessions(this.db); }
  listDiscoverySessionIds() { return discoveryRepo.listDiscoverySessionIds(this.db); }
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
