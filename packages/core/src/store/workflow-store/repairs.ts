import type { AppDatabase } from '../db.js';
import type {
  RepairCandidateOperation,
  RepairProposal,
  RepairReplaySummary,
} from '../../workflow/repair.js';
import * as repairRepo from '../repositories/workflow-repair-repository.js';

export function createRepairProposal(
  db: AppDatabase,
  params: {
    workflowId: string;
    baseVersion: number;
    candidates: RepairCandidateOperation[];
  },
) {
  return repairRepo.createWorkflowRepairProposal(db, params);
}

export function getRepairProposal(db: AppDatabase, id: string) {
  return repairRepo.getWorkflowRepairProposal(db, id);
}

export function listRepairProposals(
  db: AppDatabase,
  options: { workflowId?: string; status?: RepairProposal['status'] } = {},
) {
  return repairRepo.listWorkflowRepairProposals(db, options);
}

export function updateRepairProposalReplay(
  db: AppDatabase,
  id: string,
  replay: RepairReplaySummary,
) {
  return repairRepo.updateWorkflowRepairProposalReplay(db, id, replay);
}

export function updateRepairProposal(
  db: AppDatabase,
  id: string,
  patch: { status: RepairProposal['status']; appliedVersion?: number; rejectionReason?: string },
) {
  return repairRepo.updateWorkflowRepairProposal(db, id, patch);
}
