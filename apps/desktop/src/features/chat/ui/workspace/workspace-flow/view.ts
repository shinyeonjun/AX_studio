import type { WorkspaceChatMessage } from '@ax-studio/core';
import type { WorkspaceWorkflowState } from '../../../hooks/useWorkspaceChat';
import type {
  DiscoveryFlowState,
  FlowStatus,
  WorkspaceFlowPresentation,
} from './model';

export const FLOW_STAGES = [
  { label: '요청 접수', subtitle: '요청 내용 확인' },
  { label: '진행 중', subtitle: '방법을 찾는 중' },
  { label: '방법 검토', subtitle: '조회 결과 확인' },
  { label: '승인 대기', subtitle: '사용자 결정 필요' },
  { label: '실행 완료', subtitle: '승인 후 결과 표시' },
] as const;

export type FlowStageState = 'done' | 'active' | 'pending';

export function stageState(index: number, activeStage: number): FlowStageState {
  if (index < activeStage) return 'done';
  if (index === activeStage) return 'active';
  return 'pending';
}

export function stageSubtitle(
  index: number,
  presentation: WorkspaceFlowPresentation,
  progress: string,
  discovery?: DiscoveryFlowState,
  latest?: WorkspaceChatMessage,
): string {
  if (index === 1 && presentation.status === 'running') {
    return progress.trim() || discovery?.progress || FLOW_STAGES[index].subtitle;
  }
  if (index === 3 && presentation.status === 'approval' && latest?.approval?.title) {
    return latest.approval.title;
  }
  if (index === 4) {
    if (presentation.status === 'success') return '결과 표시';
    if (presentation.status === 'cancelled') return '실행이 취소됨';
    if (presentation.status === 'error') return '오류를 확인하세요';
  }
  return FLOW_STAGES[index].subtitle;
}

export function methodTitle(
  workflow?: WorkspaceWorkflowState | null,
  discovery?: DiscoveryFlowState,
): string | undefined {
  const candidates = [
    workflow?.summary,
    workflow?.workflow?.goal,
    workflow?.title,
    discovery?.progress,
  ];
  return candidates.find((value) => value?.trim())?.trim();
}

export function methodDetail(workflow?: WorkspaceWorkflowState | null): string {
  const nodeCount = workflow?.workflow?.nodes.length;
  if (nodeCount) return `${nodeCount}개 단계로 구성된 실행 방법입니다.`;
  return '대화에서 확인한 실행 방법입니다.';
}

export function statusClass(status: FlowStatus): string {
  return `workspace-flow-status workspace-flow-status--${status}`;
}
