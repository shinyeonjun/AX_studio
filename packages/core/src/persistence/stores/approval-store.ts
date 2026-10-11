import type { AppDatabase } from '../db.js';
import type { ToolSendOutcome } from '../../contracts/tool-result.js';
import * as approvalRepo from '../repositories/approval-repository.js';

export class ApprovalStore {
  constructor(private readonly db: AppDatabase) {}

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
}
