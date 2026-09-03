import type { AppDatabase } from '../db.js';
import type { AgentScopedContextPatch } from '../../agent/scoped-context.js';
import * as workspaceChatRepo from '../repositories/workspace-chat-repository.js';
import * as workspaceSourceRepo from '../repositories/workspace-source-repository.js';

export function saveWorkspaceChat(
  db: AppDatabase,
  params: {
    id?: string;
    messages: workspaceChatRepo.WorkspaceChatMessage[];
    workflowId?: string | null;
  },
) {
  return workspaceChatRepo.saveWorkspaceChat(db, params);
}

export function upsertWorkspaceChatExecutionResult(
  db: AppDatabase,
  sessionId: string,
  message: workspaceChatRepo.WorkspaceChatMessage & {
    kind: 'execution_result';
    executionId: string;
  },
) {
  return workspaceChatRepo.upsertWorkspaceChatExecutionResult(db, sessionId, message);
}

export function getWorkspaceChat(db: AppDatabase, id: string) {
  return workspaceChatRepo.getWorkspaceChat(db, id);
}

export function getWorkspaceChatMemo(db: AppDatabase, sessionId: string) {
  return workspaceChatRepo.getWorkspaceChatMemo(db, sessionId);
}

export function updateWorkspaceChatMemo(
  db: AppDatabase,
  sessionId: string,
  patch: AgentScopedContextPatch,
) {
  return workspaceChatRepo.updateWorkspaceChatMemo(db, sessionId, patch);
}

export function getWorkspaceChatByWorkflowId(db: AppDatabase, workflowId: string) {
  return workspaceChatRepo.getWorkspaceChatByWorkflowId(db, workflowId);
}

export function listWorkspaceChats(db: AppDatabase, limit = 50) {
  return workspaceChatRepo.listWorkspaceChats(db, limit);
}

export function deleteWorkspaceChat(db: AppDatabase, id: string) {
  workspaceChatRepo.deleteWorkspaceChat(db, id);
}

export function refreshWorkspaceChatTitle(db: AppDatabase, sessionId: string) {
  return workspaceChatRepo.refreshWorkspaceChatTitle(db, sessionId);
}

export function insertWorkspaceSource(
  db: AppDatabase,
  record: workspaceSourceRepo.WorkspaceSourceRecord,
) {
  return workspaceSourceRepo.insertWorkspaceSource(db, record);
}

export function updateWorkspaceSource(
  db: AppDatabase,
  id: string,
  patch: Partial<Omit<workspaceSourceRepo.WorkspaceSourceRecord, 'id' | 'sessionId' | 'artifactId' | 'fileName' | 'createdAt'>>,
) {
  return workspaceSourceRepo.updateWorkspaceSource(db, id, patch);
}

export function getWorkspaceSource(db: AppDatabase, sessionId: string, id: string) {
  return workspaceSourceRepo.getWorkspaceSource(db, sessionId, id);
}

export function listWorkspaceSources(db: AppDatabase, sessionId: string) {
  return workspaceSourceRepo.listWorkspaceSources(db, sessionId);
}

export function countWorkspaceSourcesForArtifact(
  db: AppDatabase,
  artifactId: string,
  excludeSessionId: string,
) {
  return workspaceSourceRepo.countWorkspaceSourcesForArtifact(db, artifactId, excludeSessionId);
}
