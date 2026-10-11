import type { AppDatabase } from '../db.js';
import type { AgentScopedContextPatch } from '../../intelligence/agent/scoped-context.js';
import * as workspaceChatRepo from '../repositories/workspace-chat-repository.js';
import * as workspaceSourceRepo from '../repositories/workspace-source-repository.js';

export class WorkspaceChatStore {
  private readonly sessionDeletionObservers = new Set<(id: string) => void>();
  constructor(private readonly db: AppDatabase) {}

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
}
