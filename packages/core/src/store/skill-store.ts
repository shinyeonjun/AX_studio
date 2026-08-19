import type { AppDatabase } from './db.js';
import type { SkillIR } from '../skill/schema.js';
import * as skillRepo from './repositories/skill-repository.js';
import * as executionRepo from './repositories/execution-repository.js';
import * as approvalRepo from './repositories/approval-repository.js';
import * as settingsRepo from './repositories/settings-repository.js';

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

  createExecution(params: {
    skillId?: string;
    skillVersion?: number;
    ephemeral: boolean;
    triggerType?: string;
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

  createApproval(params: { executionId: string; actionIds: string[]; reason: string; payload?: unknown }) {
    return approvalRepo.createApproval(this.db, params);
  }

  resolveApproval(id: string, approved: boolean) {
    approvalRepo.resolveApproval(this.db, id, approved);
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
