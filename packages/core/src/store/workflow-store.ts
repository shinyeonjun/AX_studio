import type { AppDatabase } from './db.js';
import type { WorkflowIR } from '../workflow/schema.js';
import * as workflowRepo from './repositories/workflow-repository.js';
import * as executionRepo from './repositories/execution-repository.js';
import * as approvalRepo from './repositories/approval-repository.js';
import * as settingsRepo from './repositories/settings-repository.js';
import * as chatSessionRepo from './repositories/chat-session-repository.js';

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
    workflowRepo.setWorkflowActive(this.db, workflowId, active);
  }

  deleteWorkflow(workflowId: string) {
    return workflowRepo.deleteWorkflow(this.db, workflowId);
  }

  saveChatSession(params: { state: import('../interview/interview-state.js').InterviewState; summary?: string; workflowId?: string }) {
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

  createExecution(params: {
    workflowId?: string;
    workflowVersion?: number;
    ephemeral: boolean;
    triggerType?: string;
    irJson?: string;
  }) {
    return executionRepo.createExecution(this.db, params);
  }

  finishExecution(id: string, status: 'success' | 'failed' | 'cancelled', errorCode?: string, log?: unknown[]) {
    executionRepo.finishExecution(this.db, id, status, errorCode, log);
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
