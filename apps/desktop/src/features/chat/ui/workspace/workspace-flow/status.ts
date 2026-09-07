import type { DiscoveryInspectView, ExecutionResultStatus } from '@ax-studio/core';
import type { WorkspaceWorkflowState } from '../../../hooks/useWorkspaceChat.js';
import type { DiscoveryFlowState, FlowStatus } from './contracts.js';

export const DISCOVERY_RUNNING_STATUSES = new Set<DiscoveryInspectView['status']>([
  'collecting_examples',
  'observing_output',
  'inventory_sources',
  'exploring_sources',
  'synthesizing',
  'validating',
  'publishing',
]);

export function statusLabel(status: FlowStatus): string {
  switch (status) {
    case 'running':
      return '진행 중';
    case 'review':
      return '방법 검토';
    case 'approval':
      return '승인 대기';
    case 'success':
      return '실행 완료';
    case 'cancelled':
      return '실행 취소';
    case 'error':
      return '확인 필요';
    default:
      return '대기 중';
  }
}

export function executionStage(status: ExecutionResultStatus | undefined): number | undefined {
  switch (status) {
    case 'pending_approval':
      return 3;
    case 'success':
    case 'failed':
    case 'cancelled':
      return 4;
    default:
      return undefined;
  }
}

export function reviewStage(
  workflow?: WorkspaceWorkflowState | null,
  discovery?: DiscoveryFlowState,
): number {
  if (workflow || discovery) return 2;
  return 1;
}
