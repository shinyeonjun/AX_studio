import type { AppDatabase } from './db.js';
import type { WorkflowIR } from '../workflow/schema.js';
import type { ExecutionStatus } from './rows.js';
import * as workflowRepo from './repositories/workflow-repository.js';
import * as executionRepo from './repositories/execution-repository.js';
import * as approvalRepo from './repositories/approval-repository.js';
import * as settingsRepo from './repositories/settings-repository.js';
import * as chatSessionRepo from './repositories/chat-session-repository.js';
import * as workspaceChatRepo from './repositories/workspace-chat-repository.js';

export class WorkflowStore {
  constructor(private db: AppDatabase) {}

  saveWorkflow(ir: WorkflowIR) {
    return workflowRepo.saveWorkflow(this.db, ir);
  }

  getWorkflow(workflowId: string, version?: number) {
    return workflowRepo.getWorkflow(this.db, workflowId, version);
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

  saveChatSession(params: { state: import('../interview/session/state.js').InterviewState; summary?: string; workflowId?: string }) {
    return chatSessionRepo.saveChatSession(this.db, params);
  }

  getChatSession(sessionId: string) {
    return chatSessionRepo.getChatSession(this.db, sessionId);
  }

  getChatSessionByWorkflowId(workflowId: string) {
    return chatSessionRepo.getChatSessionByWorkflowId(this.db, workflowId);
  }

  linkChatSessionToWorkflow(sessionId: string, workflowId: string) {
    chatSessionRepo.linkChatSessionToWorkflow(this.db, sessionId, workflowId);
  }

  listChatSessions(limit = 20) {
    return chatSessionRepo.listChatSessions(this.db, limit);
  }

  listChatSessionSummaries(limit = 20) {
    return chatSessionRepo.listChatSessionSummaries(this.db, limit);
  }

  deleteChatSession(sessionId: string) {
    chatSessionRepo.deleteChatSession(this.db, sessionId);
  }

  saveWorkspaceChat(params: { id?: string; messages: workspaceChatRepo.WorkspaceChatMessage[] }) {
    return workspaceChatRepo.saveWorkspaceChat(this.db, params);
  }

  getWorkspaceChat(id: string) {
    return workspaceChatRepo.getWorkspaceChat(this.db, id);
  }

  listWorkspaceChats(limit = 50) {
    return workspaceChatRepo.listWorkspaceChats(this.db, limit);
  }

  deleteWorkspaceChat(id: string) {
    workspaceChatRepo.deleteWorkspaceChat(this.db, id);
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

  setSetting(key: string, value: unknown) {
    settingsRepo.setSetting(this.db, key, value);
  }

  setConnection(connector: string, connected: boolean, config?: Record<string, unknown>) {
    settingsRepo.setConnection(this.db, connector, connected, config);
  }

  getConnections() {
    return settingsRepo.getConnections(this.db);
  }
}
