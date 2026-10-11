import type { AppDatabase } from '../db.js';
import type { RepairCandidateOperation, RepairProposal, RepairReplaySummary } from '../../workflow/repair.js';
import * as repairRepo from '../repositories/workflow-repair-repository.js';

export class RepairStore {
  constructor(private readonly db: AppDatabase) {}

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
