import type { AppDatabase } from '../db.js';
import * as approvalRepo from '../repositories/approval-repository.js';

export function createApproval(
  db: AppDatabase,
  params: { executionId: string; actionIds: string[]; reason: string; payload?: unknown },
) {
  return approvalRepo.createApproval(db, params);
}

export function resolveApproval(db: AppDatabase, id: string, approved: boolean) {
  approvalRepo.resolveApproval(db, id, approved);
}

export function rejectPendingApproval(db: AppDatabase, id: string) {
  return approvalRepo.rejectPendingApproval(db, id);
}

export function failApproval(db: AppDatabase, id: string) {
  return approvalRepo.failApproval(db, id);
}

export function claimApproval(db: AppDatabase, id: string) {
  return approvalRepo.claimApproval(db, id);
}

export function updateApprovalPayload(db: AppDatabase, id: string, extra: Record<string, unknown>) {
  approvalRepo.updateApprovalPayload(db, id, extra);
}

export function getApproval(db: AppDatabase, id: string) {
  return approvalRepo.getApproval(db, id);
}

export function getPendingApprovals(db: AppDatabase) {
  return approvalRepo.getPendingApprovals(db);
}
