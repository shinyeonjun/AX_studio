import type {
  WorkspaceFlowPanelProps,
  WorkspaceFlowPresentation,
} from './workspace-flow/model';
import {
  latestWorkspaceExecutionResult,
  resolveWorkspaceFlowPresentation,
} from './workspace-flow/model';
import {
  FLOW_STAGES,
  methodDetail,
  methodTitle,
  stageState,
  stageSubtitle,
  statusClass,
} from './workspace-flow/view';
import { executionStatusLabel } from '../../lib/work-display';
import { resolveWorkspaceExecutionStatus } from './WorkspaceRunResultCard';

export type { WorkspaceFlowPanelProps, WorkspaceFlowPresentation } from './workspace-flow/model';
export {
  latestWorkspaceExecutionResult,
  resolveWorkspaceFlowPresentation,
} from './workspace-flow/model';

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
