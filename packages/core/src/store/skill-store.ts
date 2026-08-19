import type { AppDatabase } from './db.js';
import type { SkillIR } from '../skill/schema.js';
import * as skillRepo from './repositories/skill-repository.js';
import * as executionRepo from './repositories/execution-repository.js';
import * as approvalRepo from './repositories/approval-repository.js';
import * as settingsRepo from './repositories/settings-repository.js';
import * as chatSessionRepo from './repositories/chat-session-repository.js';

export class SkillStore {
  constructor(private db: AppDatabase) {}

  saveSkill(ir: SkillIR) {
    return skillRepo.saveSkill(this.db, ir);
  }

  getSkill(skillId: string, version?: number) {
    return skillRepo.getSkill(this.db, skillId, version);
  }

  listSkills() {
    return skillRepo.listSkills(this.db);
  }

  setSkillActive(skillId: string, active: boolean) {
    skillRepo.setSkillActive(this.db, skillId, active);
  }

  deleteSkill(skillId: string) {
    return skillRepo.deleteSkill(this.db, skillId);
  }

  saveChatSession(params: { state: import('../interview/interview-state.js').InterviewState; summary?: string; skillId?: string }) {
    return chatSessionRepo.saveChatSession(this.db, params);
  }

  getChatSession(sessionId: string) {
    return chatSessionRepo.getChatSession(this.db, sessionId);
  }

  getChatSessionBySkillId(skillId: string) {
    return chatSessionRepo.getChatSessionBySkillId(this.db, skillId);
  }

  linkChatSessionToSkill(sessionId: string, skillId: string) {
    chatSessionRepo.linkChatSessionToSkill(this.db, sessionId, skillId);
  }

  listChatSessions(limit = 20) {
    return chatSessionRepo.listChatSessions(this.db, limit);
  }

  createExecution(params: {
    skillId?: string;
    skillVersion?: number;
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
