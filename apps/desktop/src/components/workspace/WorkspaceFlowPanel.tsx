import type {
  DiscoveryInspectView,
  ExecutionResultStatus,
  WorkspaceChatMessage,
} from '@ax-studio/core';
import type { WorkspaceWorkflowState } from '../../hooks/useWorkspaceChat';
import { executionStatusLabel } from '../../lib/work-display';
import { resolveWorkspaceExecutionStatus } from './WorkspaceRunResultCard';

type FlowStatus = 'idle' | 'running' | 'review' | 'approval' | 'success' | 'cancelled' | 'error';
type FlowStageState = 'done' | 'active' | 'pending';

type DiscoveryFlowState = Pick<DiscoveryInspectView, 'status' | 'progress' | 'replaySummary'>;

export interface WorkspaceFlowPanelProps {
  messages: WorkspaceChatMessage[];
  busy: boolean;
  discoveryBusy?: boolean;
  progress: string;
  error?: string;
  discovery?: DiscoveryFlowState;
  workflow?: WorkspaceWorkflowState | null;
}

export interface WorkspaceFlowPresentation {
  status: FlowStatus;
  statusLabel: string;
  activeStage: number;
  message: string;
}

const FLOW_STAGES = [
  { label: '요청 접수', subtitle: '요청 내용 확인' },
  { label: '진행 중', subtitle: '방법을 찾는 중' },
  { label: '방법 검토', subtitle: '조회 결과 확인' },
  { label: '승인 대기', subtitle: '사용자 결정 필요' },
  { label: '실행 완료', subtitle: '승인 후 결과 표시' },
] as const;

const DISCOVERY_RUNNING_STATUSES = new Set<DiscoveryInspectView['status']>([
  'collecting_examples',
  'observing_output',
  'inventory_sources',
  'exploring_sources',
  'synthesizing',
  'validating',
  'publishing',
]);

function statusLabel(status: FlowStatus): string {
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

function executionStage(status: ExecutionResultStatus | undefined): number | undefined {
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

export function latestWorkspaceExecutionResult(
  messages: WorkspaceChatMessage[],
): WorkspaceChatMessage | undefined {
  return [...messages].reverse().find((message) => message.kind === 'execution_result');
}

function reviewStage(workflow?: WorkspaceWorkflowState | null, discovery?: DiscoveryFlowState): number {
  if (workflow || discovery) return 2;
  return 1;
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

  if (DISCOVERY_RUNNING_STATUSES.has(discovery?.status as DiscoveryInspectView['status']) || isBusy) {
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

function stageState(index: number, activeStage: number): FlowStageState {
  if (index < activeStage) return 'done';
  if (index === activeStage) return 'active';
  return 'pending';
}

function stageSubtitle(
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

function methodTitle(
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

function methodDetail(workflow?: WorkspaceWorkflowState | null): string {
  const nodeCount = workflow?.workflow?.nodes.length;
  if (nodeCount) return `${nodeCount}개 단계로 구성된 실행 방법입니다.`;
  return '대화에서 확인한 실행 방법입니다.';
}

function statusClass(status: FlowStatus): string {
  return `workspace-flow-status workspace-flow-status--${status}`;
}

export function WorkspaceFlowPanel({
  messages,
  busy,
  discoveryBusy = false,
  progress,
  error,
  discovery,
  workflow,
}: WorkspaceFlowPanelProps) {
  const presentation = resolveWorkspaceFlowPresentation({
    messages,
    busy,
    discoveryBusy,
    progress,
    error,
    discovery,
    workflow,
  });
  const latest = latestWorkspaceExecutionResult(messages);
  const executionStatus = resolveWorkspaceExecutionStatus(latest?.executionStatus, latest?.content ?? '');
  const foundMethod = methodTitle(workflow, discovery);
  const replay = discovery?.replaySummary;

  return (
    <section className="workspace-flow-panel" aria-label="실행 흐름">
      <header className="workspace-flow-header">
        <div>
          <h2 className="workspace-flow-title">실행 흐름</h2>
          <p className="workspace-flow-subtitle">지금 어디까지 진행됐는지 확인하세요.</p>
        </div>
        <span className={statusClass(presentation.status)}>{presentation.statusLabel}</span>
      </header>

      <section
        className="workspace-flow-stage-card"
        aria-label="요청부터 실행까지"
        data-flow-status={presentation.status}
      >
        <h3>요청부터 실행까지</h3>
        <ol className="workspace-flow-stage-list">
          {FLOW_STAGES.map((stage, index) => {
            const state = stageState(index, presentation.activeStage);
            return (
              <li
                key={stage.label}
                className={`workspace-flow-stage workspace-flow-stage--${state}`}
                aria-current={state === 'active' ? 'step' : undefined}
              >
                <span className="workspace-flow-stage-marker" aria-hidden="true">{index + 1}</span>
                <div className="workspace-flow-stage-copy">
                  <strong>{stage.label}</strong>
                  <span>{stageSubtitle(index, presentation, progress, discovery, latest)}</span>
                </div>
              </li>
            );
          })}
        </ol>
      </section>

      {foundMethod && (
        <section className="workspace-flow-method" aria-label="찾은 방법">
          <p className="workspace-flow-method-label">찾은 방법</p>
          <strong>{foundMethod}</strong>
          <span>{methodDetail(workflow)}</span>
          {replay && replay.total > 0 && (
            <em className={replay.failed > 0 ? 'workspace-flow-validation--warning' : 'workspace-flow-validation'}>
              검증 {replay.passed}건 중 {replay.total}건 통과
            </em>
          )}
        </section>
      )}

      {executionStatus === 'pending_approval' && latest?.approval && (
        <section className="workspace-flow-approval" aria-label="승인 대상">
          <p className="workspace-flow-approval-label">외부 작업 전 확인</p>
          <strong>{latest.approval.title}</strong>
          <p>{latest.approval.reason}</p>
          <span>채팅의 승인 카드에서 결정하세요.</span>
        </section>
      )}

      {latest && executionStatus && executionStatus !== 'pending_approval' && (
        <section className="workspace-flow-receipt" aria-label="최근 실행 결과">
          <span>최근 실행</span>
          <strong>{executionStatusLabel(executionStatus)}</strong>
          <p>{presentation.message}</p>
        </section>
      )}

      {error && (
        <div className="workspace-flow-error" role="alert">
          <strong>확인 필요</strong>
          <p>{error}</p>
          <span>오류를 해결한 뒤 대화에서 다시 요청할 수 있어요.</span>
        </div>
      )}
    </section>
  );
}
