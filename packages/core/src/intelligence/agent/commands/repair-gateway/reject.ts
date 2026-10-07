import type { WorkflowStore } from '../../../../persistence/workflow-store.js';
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
  if (!proposal) return ['not_found', undefined, [issue('repair_not_found', '고칠 방법 제안을 찾지 못했습니다. 업무 화면에서 다시 열어 주세요.', 'args.repairId')]];
  if (proposal.status !== 'proposed') {
    return ['conflict', { status: proposal.status }, [issue('repair_not_proposed', '이미 처리한 고칠 방법 제안이라 다시 거절할 수 없습니다.')]];
  }
  if (proposal.baseVersion !== parsed.data.baseVersion) {
    return ['conflict', { baseVersion: proposal.baseVersion }, [issue('repair_base_version_mismatch', '업무가 그사이 바뀌어 이 고칠 방법 제안을 쓸 수 없습니다. 제안을 다시 받아 주세요.', 'args.baseVersion')]];
  }
  const updated = store.updateRepairProposal(proposal.id, {
    status: 'rejected',
    rejectionReason: parsed.data.reason ?? '사용자가 고칠 방법 적용을 거절했습니다.',
  });
  return updated
    ? ['ok', { repairId: updated.id, workflowId: updated.workflowId, status: updated.status }]
    : ['not_found', undefined, [issue('repair_not_found', '고칠 방법 제안을 찾지 못했습니다. 업무 화면에서 다시 열어 주세요.')]];
}
