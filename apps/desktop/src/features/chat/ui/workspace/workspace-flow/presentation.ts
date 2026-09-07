import type { DiscoveryInspectView, WorkspaceChatMessage } from '@ax-studio/core';
import { resolveWorkspaceExecutionStatus } from '../WorkspaceRunResultCard.js';
import type {
  DiscoveryFlowState,
  WorkspaceFlowPanelProps,
  WorkspaceFlowPresentation,
} from './contracts.js';
import {
  DISCOVERY_RUNNING_STATUSES,
  executionStage,
  reviewStage,
  statusLabel,
} from './status.js';

export function latestWorkspaceExecutionResult(
  messages: WorkspaceChatMessage[],
): WorkspaceChatMessage | undefined {
  return [...messages].reverse().find((message) => message.kind === 'execution_result');
}

function resolveDiscoveryRunning(
  discovery?: DiscoveryFlowState,
): boolean {
  return DISCOVERY_RUNNING_STATUSES.has(discovery?.status as DiscoveryInspectView['status']);
}

export function resolveWorkspaceFlowPresentation({
  messages,
  busy,
  discoveryBusy = false,
  progress,
  error = '',
  discovery,
  workflow,
}: WorkspaceFlowPanelProps): WorkspaceFlowPresentation {
  const latest = latestWorkspaceExecutionResult(messages);
  const executionStatus = resolveWorkspaceExecutionStatus(latest?.executionStatus, latest?.content ?? '');
  const executionStageIndex = executionStage(executionStatus);
  const isBusy = busy || discoveryBusy;
  const normalizedError = error.trim();

  if (normalizedError) {
    return {
      status: 'error',
      statusLabel: statusLabel('error'),
      activeStage: executionStageIndex ?? reviewStage(workflow, discovery),
      message: normalizedError,
    };
  }

  if (resolveDiscoveryRunning(discovery) || isBusy) {
    return {
      status: 'running',
      statusLabel: statusLabel('running'),
      activeStage: 1,
      message: progress.trim() || discovery?.progress || '방법을 찾는 중입니다.',
    };
  }

  if (executionStatus === 'pending_approval') {
    return {
      status: 'approval',
      statusLabel: statusLabel('approval'),
      activeStage: 3,
      message: latest?.approval?.title ?? '사용자의 승인이 필요합니다.',
    };
  }

  if (executionStatus === 'success') {
    return {
      status: 'success',
      statusLabel: statusLabel('success'),
      activeStage: 4,
      message: '최근 실행 결과를 확인하세요.',
    };
  }

  if (executionStatus === 'cancelled') {
    return {
      status: 'cancelled',
      statusLabel: statusLabel('cancelled'),
      activeStage: 4,
      message: '실행이 취소되었습니다.',
    };
  }

  if (executionStatus === 'failed') {
    return {
      status: 'error',
      statusLabel: statusLabel('error'),
      activeStage: 4,
      message: '실행 결과에서 오류를 확인하세요.',
    };
  }

  if (discovery?.status === 'failed' || discovery?.status === 'needs_attention') {
    return {
      status: 'error',
      statusLabel: statusLabel('error'),
      activeStage: 2,
      message: discovery.progress || '업무 방법을 확인하지 못했습니다.',
    };
  }

  if (
    discovery?.status === 'needs_clarification' ||
    discovery?.status === 'ready_to_publish' ||
    workflow
  ) {
    return {
      status: 'review',
      statusLabel: statusLabel('review'),
      activeStage: 2,
      message: '찾은 방법을 확인하고 다음 결정을 내려 주세요.',
    };
  }

  return {
    status: 'idle',
    statusLabel: statusLabel('idle'),
    activeStage: 0,
    message: '요청을 보내면 진행 상태가 여기에 표시됩니다.',
  };
}
