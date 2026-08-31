import { join } from 'node:path';
import { getAxDataPaths } from '../../paths/ax-data.js';
import type { WorkflowStore } from '../../store/workflow-store.js';
import {
  applyRepairCandidate,
  type RepairProposal,
} from '../../workflow/repair.js';
import { replayRepairCandidate } from '../../work-discovery/repair.js';
import {
  AxRepairApplyArgsSchema,
  AxRepairInspectArgsSchema,
  AxRepairListArgsSchema,
  AxRepairRejectArgsSchema,
  type AxCommand,
  type AxCommandIssue,
  type AxCommandResult,
} from './schema.js';

export type RepairCommandResult = [AxCommandResult['status'], unknown, AxCommandIssue[]?];

export interface RepairCommandGateway {
  list(command: AxCommand): RepairCommandResult;
  inspect(command: AxCommand): RepairCommandResult;
  apply(command: AxCommand): RepairCommandResult;
  reject(command: AxCommand): RepairCommandResult;
}

export interface RepairGatewayOptions {
  snapshotRoot?: string;
}

function issue(code: string, message: string, path?: string): AxCommandIssue {
  return { code, message, ...(path ? { path } : {}) };
}

function summary(proposal: RepairProposal) {
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

function snapshotRoot(options: RepairGatewayOptions): string {
  return options.snapshotRoot ?? join(getAxDataPaths().root, 'discovery', 'snapshots');
}

export function createRepairCommandGateway(
  store: WorkflowStore,
  options: RepairGatewayOptions = {},
): RepairCommandGateway {
  return {
    list: (command) => list(store, command),
    inspect: (command) => inspect(store, options, command),
    apply: (command) => apply(store, options, command),
    reject: (command) => reject(store, command),
  };
}

function list(store: WorkflowStore, command: AxCommand): RepairCommandResult {
  const parsed = AxRepairListArgsSchema.safeParse(command.args);
  if (!parsed.success) return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
  return ['ok', {
    proposals: store.listRepairProposals({ workflowId: parsed.data.workflowId, status: parsed.data.status }).map(summary),
  }];
}

function inspect(
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
      replay: replayRepairCandidate(store, workflow, candidate, { snapshotRoot: snapshotRoot(options) }),
    }))
    : [];
  const replay = candidateReplays[0]?.replay ?? proposal.replay;
  return ['ok', { proposal: summary(proposal), replay, candidateReplays }];
}

function apply(
  store: WorkflowStore,
  options: RepairGatewayOptions,
  command: AxCommand,
): RepairCommandResult {
  const parsed = AxRepairApplyArgsSchema.safeParse(command.args);
  if (!parsed.success) return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
  const proposal = store.getRepairProposal(parsed.data.repairId);
  if (!proposal) return ['not_found', undefined, [issue('repair_not_found', 'repair 제안을 찾을 수 없습니다.', 'args.repairId')]];
  if (proposal.status !== 'proposed') {
    return ['conflict', { status: proposal.status }, [issue('repair_not_proposed', '이미 처리된 repair 제안은 다시 적용할 수 없습니다.')]];
  }
  if (proposal.baseVersion !== parsed.data.baseVersion) {
    return ['conflict', { baseVersion: proposal.baseVersion }, [issue('repair_base_version_mismatch', 'repair 제안의 기준 버전과 일치하지 않습니다.', 'args.baseVersion')]];
  }
  const workflow = store.getWorkflow(proposal.workflowId);
  if (!workflow) return ['not_found', undefined, [issue('workflow_not_found', 'workflow를 찾을 수 없습니다.')]];
  if (workflow.version !== parsed.data.baseVersion) {
    return ['conflict', { currentVersion: workflow.version }, [issue('stale_workflow_version', 'workflow가 최신 버전으로 변경되었습니다.', 'args.baseVersion')]];
  }
  const candidate = proposal.candidates.find((entry) => entry.id === parsed.data.candidateId);
  if (!candidate) return ['not_found', undefined, [issue('repair_candidate_not_found', 'repair 후보를 찾을 수 없습니다.', 'args.candidateId')]];

  const replay = replayRepairCandidate(store, workflow, candidate, { snapshotRoot: snapshotRoot(options) });
  if (replay.status !== 'passed') {
    return [
      'conflict',
      { applied: false, replay },
      [issue(
        replay.status === 'unavailable' ? 'repair_replay_unavailable' : 'repair_replay_failed',
        '모든 과거 replay가 통과하기 전에는 repair를 적용할 수 없습니다.',
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

function reject(store: WorkflowStore, command: AxCommand): RepairCommandResult {
  const parsed = AxRepairRejectArgsSchema.safeParse(command.args);
  if (!parsed.success) return ['invalid', undefined, [issue('invalid_arguments', parsed.error.message)]];
  const proposal = store.getRepairProposal(parsed.data.repairId);
  if (!proposal) return ['not_found', undefined, [issue('repair_not_found', 'repair 제안을 찾을 수 없습니다.', 'args.repairId')]];
  if (proposal.status !== 'proposed') {
    return ['conflict', { status: proposal.status }, [issue('repair_not_proposed', '이미 처리된 repair 제안은 다시 거부할 수 없습니다.')]];
  }
  if (proposal.baseVersion !== parsed.data.baseVersion) {
    return ['conflict', { baseVersion: proposal.baseVersion }, [issue('repair_base_version_mismatch', 'repair 제안의 기준 버전과 일치하지 않습니다.', 'args.baseVersion')]];
  }
  const updated = store.updateRepairProposal(proposal.id, {
    status: 'rejected',
    rejectionReason: parsed.data.reason ?? '사용자가 repair 적용을 거부했습니다.',
  });
  return updated
    ? ['ok', { repairId: updated.id, workflowId: updated.workflowId, status: updated.status }]
    : ['not_found', undefined, [issue('repair_not_found', 'repair 제안을 찾을 수 없습니다.')]];
}
