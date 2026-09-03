import { join } from 'node:path';
import { getAxDataPaths } from '../../../paths/ax-data.js';
import type { RepairProposal } from '../../../workflow/repair.js';
import type { RepairGatewayOptions } from './contracts.js';
import type { AxCommandIssue } from '../schema.js';

export function issue(code: string, message: string, path?: string): AxCommandIssue {
  return { code, message, ...(path ? { path } : {}) };
}

export function summarizeRepairProposal(proposal: RepairProposal) {
  return {
    id: proposal.id,
    workflowId: proposal.workflowId,
    baseVersion: proposal.baseVersion,
    status: proposal.status,
    candidates: proposal.candidates.map((candidate) => ({
      id: candidate.id,
      op: candidate.op,
      sourceId: candidate.sourceId,
      stepId: candidate.stepId,
      from: candidate.from,
      to: candidate.to,
      expectedType: candidate.expectedType,
      actualType: candidate.actualType,
      confidence: candidate.confidence,
    })),
    replay: proposal.replay,
    ...(proposal.appliedVersion === undefined ? {} : { appliedVersion: proposal.appliedVersion }),
    ...(proposal.rejectionReason === undefined ? {} : { rejectionReason: proposal.rejectionReason }),
    createdAt: proposal.createdAt,
    updatedAt: proposal.updatedAt,
  };
}

export function resolveSnapshotRoot(options: RepairGatewayOptions): string {
  return options.snapshotRoot ?? join(getAxDataPaths().root, 'discovery', 'snapshots');
}
