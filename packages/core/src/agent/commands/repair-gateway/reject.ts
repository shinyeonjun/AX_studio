import type { WorkflowStore } from '../../../store/workflow-store.js';
import {
  AxRepairRejectArgsSchema,
  type AxCommand,
} from '../schema.js';
import { issue } from './shared.js';
import type { RepairCommandResult } from './contracts.js';

export function rejectRepairProposal(store: WorkflowStore, command: AxCommand): RepairCommandResult {
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
