import type { WorkflowStore } from '../../../store/workflow-store.js';
import { replayRepairCandidate } from '../../../work-discovery/repair.js';
import {
  AxRepairInspectArgsSchema,
  type AxCommand,
} from '../schema.js';
import { issue, resolveSnapshotRoot, summarizeRepairProposal } from './shared.js';
import type { RepairCommandResult, RepairGatewayOptions } from './contracts.js';

export function inspectRepairProposal(
  store: WorkflowStore,
  options: RepairGatewayOptions,
  command: AxCommand,
): RepairCommandResult {
  const parsed = AxRepairInspectArgsSchema.safeParse(command.args);
  if (!parsed.success) return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
  const proposal = store.getRepairProposal(parsed.data.repairId);
  if (!proposal) return ['not_found', undefined, [issue('repair_not_found', 'repair 제안을 찾을 수 없습니다.', 'args.repairId')]];
  const workflow = store.getWorkflow(proposal.workflowId, proposal.baseVersion);
  if (!workflow) return ['not_found', undefined, [issue('workflow_version_not_found', 'repair 기준 workflow 버전을 찾을 수 없습니다.')]];
  const candidateReplays = proposal.status === 'proposed'
    ? proposal.candidates.map((candidate) => ({
      candidateId: candidate.id,
      replay: replayRepairCandidate(store, workflow, candidate, { snapshotRoot: resolveSnapshotRoot(options) }),
    }))
    : [];
  const replay = candidateReplays[0]?.replay ?? proposal.replay;
  return ['ok', { proposal: summarizeRepairProposal(proposal), replay, candidateReplays }];
}
