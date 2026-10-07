import type { WorkflowStore } from '../../../../persistence/workflow-store.js';
import {
  applyRepairCandidate,
} from '../../../../workflow/repair.js';
import { replayRepairCandidate } from '../../../../work-discovery/repair.js';
import {
  AxRepairApplyArgsSchema,
  type AxCommand,
} from '../schema.js';
import { issue, resolveSnapshotRoot } from './shared.js';
import type { RepairCommandResult, RepairGatewayOptions } from './contracts.js';

export function applyRepairProposal(
  store: WorkflowStore,
  options: RepairGatewayOptions,
  command: AxCommand,
): RepairCommandResult {
  const parsed = AxRepairApplyArgsSchema.safeParse(command.args);
  if (!parsed.success) return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
  const proposal = store.getRepairProposal(parsed.data.repairId);
  if (!proposal) return ['not_found', undefined, [issue('repair_not_found', '고칠 방법 제안을 찾지 못했습니다. 업무 화면에서 다시 열어 주세요.', 'args.repairId')]];
  if (proposal.status !== 'proposed') {
    return ['conflict', { status: proposal.status }, [issue('repair_not_proposed', '이미 처리한 고칠 방법 제안이라 다시 적용할 수 없습니다.')]];
  }
  if (proposal.baseVersion !== parsed.data.baseVersion) {
    return ['conflict', { baseVersion: proposal.baseVersion }, [issue('repair_base_version_mismatch', '업무가 그사이 바뀌어 이 고칠 방법 제안을 쓸 수 없습니다. 제안을 다시 받아 주세요.', 'args.baseVersion')]];
  }
  const workflow = store.getWorkflow(proposal.workflowId);
  if (!workflow) return ['not_found', undefined, [issue('workflow_not_found', '업무를 찾을 수 없습니다.')]];
  if (workflow.version !== parsed.data.baseVersion) {
    return ['conflict', { currentVersion: workflow.version }, [issue('stale_workflow_version', '업무가 최신 버전으로 변경되었습니다.', 'args.baseVersion')]];
  }
  const candidate = proposal.candidates.find((entry) => entry.id === parsed.data.candidateId);
  if (!candidate) return ['not_found', undefined, [issue('repair_candidate_not_found', '고칠 방법 후보를 찾지 못했습니다. 제안을 다시 받아 주세요.', 'args.candidateId')]];

  const replay = replayRepairCandidate(store, workflow, candidate, { snapshotRoot: resolveSnapshotRoot(options) });
  if (replay.status !== 'passed') {
    return [
      'conflict',
      { applied: false, replay },
      [issue(
        replay.status === 'unavailable' ? 'repair_replay_unavailable' : 'repair_replay_failed',
        '지난 실행으로 다시 확인해 본 결과가 모두 통과해야 고칠 방법을 적용할 수 있습니다.',
      )],
    ];
  }

  let repaired;
  try {
    repaired = applyRepairCandidate(workflow, candidate);
  } catch (error) {
    return ['invalid', undefined, [issue('repair_apply_invalid', error instanceof Error ? error.message : String(error))]];
  }
  try {
    const saved = store.saveWorkflow({ ...repaired, version: workflow.version });
    store.updateRepairProposalReplay(proposal.id, replay);
    store.updateRepairProposal(proposal.id, { status: 'applied', appliedVersion: saved.version });
    return ['ok', {
      repairId: proposal.id,
      workflowId: saved.workflowId,
      version: saved.version,
      rollbackVersion: workflow.version,
      candidateId: candidate.id,
      replay,
    }];
  } catch (error) {
    return ['error', undefined, [issue('repair_persist_failed', error instanceof Error ? error.message : String(error))]];
  }
}
