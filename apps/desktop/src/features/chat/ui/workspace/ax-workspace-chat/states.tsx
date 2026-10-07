import type { DiscoveryInspectView } from '@ax-studio/core';
import { axStudioLogo } from '../../../../../ui/constants/brand';
import { DiscoveryReviewCard } from '../DiscoveryReviewCard';
import type { AppState } from '../../../../../types/app-state';
import { ComputedResults } from '../../../../activity/ui/activity-execution-item';
import { executionStatusLabel, executionTriggerLabel, formatRelativeTime } from '../../../../../ui/lib/work-display';
import { WELCOME_EXAMPLES } from './model';

export interface WorkspaceEmptyStageProps {
  discoveryBusy: boolean;
  onAttachExample?: () => Promise<void>;
  onSend: (text: string) => Promise<void>;
  /** A saved work is open but has no messages yet. */
  workOpen?: boolean;
  /** That work's latest runs, newest first. */
  workRuns?: AppState['executions'];
  /** That work runs only when asked. */
  workManual?: boolean;
  /** Unfinished discoveries the person can pick up again. */
  resumable?: ReadonlyArray<{ sessionId: string; goal: string }>;
  onResume?: (sessionId: string) => void;
}

export function WorkspaceEmptyStage({
  discoveryBusy,
  onAttachExample,
  onSend,
  workOpen = false,
  workRuns = [],
  workManual = true,
  resumable = [],
  onResume,
}: WorkspaceEmptyStageProps) {
  if (workOpen) {
    const latest = workRuns[0];
    return (
      <div className="ax-workspace-empty-stage">
        <div className="ax-workspace-welcome">
          {/* The work's name is already the page title above. */}
          {latest ? (
            <WorkLatestRuns runs={workRuns} />
          ) : (
            <h1>아직 실행한 적이 없어요</h1>
          )}
          <p className="ax-workspace-welcome-hint">
            {workManual
              ? "아래 '지금 실행'을 누르면 바로 실행돼요."
              : '정해진 때가 되면 자동으로 실행돼요.'}
            {' '}바꾸고 싶은 점은 여기에 적어 주세요.
          </p>
        </div>
      </div>
    );
  }
  return (
    <div className="ax-workspace-empty-stage">
      <div className="ax-workspace-welcome">
        <h1>지난 결과물을 보여주세요</h1>
        <p className="ax-workspace-welcome-hint">
          지난번에 만든 보고서나 표를 첨부하면, 연결된 데이터에서 만드는 법을 찾아 재현해 드립니다.
        </p>
        {onAttachExample && (
          <button
            type="button"
            className="ax-workspace-attach-btn"
            disabled={discoveryBusy}
            onClick={() => void onAttachExample()}
          >
            지난 결과물 첨부하기
          </button>
        )}
        {onResume && resumable.length > 0 && (
          <div className="ax-workspace-resume">
            <p className="ax-workspace-welcome-hint">지난 결과물로 만들다 멈춘 업무가 있어요.</p>
            <ul className="ax-workspace-example-list">
              {resumable.map((session) => (
                <li key={session.sessionId}>
                  <button type="button" className="ax-workspace-example-btn" onClick={() => onResume(session.sessionId)}>
                    <span className="ax-workspace-example-label">이어서 보기</span>
                    <span className="ax-workspace-example-text">{session.goal}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
        <p className="ax-workspace-welcome-hint">또는 아래처럼 말로 요청할 수도 있어요.</p>
        <ul className="ax-workspace-example-list">
          {WELCOME_EXAMPLES.map((example) => (
            <li key={example.label}>
              <button type="button" className="ax-workspace-example-btn" onClick={() => void onSend(example.text)}>
                <span className="ax-workspace-example-label">{example.label}</span>
                <span className="ax-workspace-example-text">{example.text}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

export function WorkspaceTypingState({ progress }: { progress: string }) {
  return (
    <div className="ax-workspace-message ax-workspace-message--assistant ax-workspace-typing" aria-live="polite">
      <img src={axStudioLogo} alt="" className="ax-workspace-avatar ax-workspace-avatar--assistant" aria-hidden="true" />
      <div className="ax-workspace-typing-content"><span /><span /><span /><p className="muted">{progress || '답변을 준비하고 있습니다'}</p></div>
    </div>
  );
}

export interface WorkspaceErrorStateProps {
  error: string;
  onDismissError?: () => void;
}

export function WorkspaceErrorState({ error, onDismissError }: WorkspaceErrorStateProps) {
  return (
    <div className="ax-workspace-error" role="alert">
      <span>{error}</span>
      {onDismissError && (
        <button
          type="button"
          className="ax-workspace-error-dismiss"
          aria-label="오류 닫기"
          onClick={onDismissError}
        >
          ×
        </button>
      )}
    </div>
  );
}

export interface WorkspaceDiscoveryStateProps {
  view: DiscoveryInspectView;
  busy: boolean;
  onAnswer: (questionId: string, optionId: string) => Promise<void> | void;
  onPublish: (schedule?: string) => Promise<void> | void;
  onCancel?: () => Promise<void> | void;
  onRetry?: () => Promise<void> | void;
}

export function WorkspaceDiscoveryState({
  view,
  busy,
  onAnswer,
  onPublish,
  onCancel,
  onRetry,
}: WorkspaceDiscoveryStateProps) {
  return (
    <DiscoveryReviewCard
      view={view}
      busy={busy}
      onAnswer={onAnswer}
      onPublish={onPublish}
      onCancel={onCancel}
      onRetry={onRetry}
    />
  );
}

/** What the opened work last produced, so its results are where the work is. */
function WorkLatestRuns({ runs }: { runs: AppState['executions'] }) {
  const [latest, ...older] = runs;
  if (!latest) return null;
  const ok = latest.status === 'success' && latest.resultStatus !== 'failed';
  return (
    <section className="ax-work-latest" aria-label="최근 실행 결과">
      <h2>최근 실행 · {formatRelativeTime(latest.startedAt)}</h2>
      <p className="ax-work-latest-meta">
        {executionTriggerLabel(latest.triggerType)} · {ok ? '완료' : executionStatusLabel(latest.status)}
      </p>
      {ok && (latest.sourceFile || latest.computedResults?.length) ? (
        <ComputedResults sourceFile={latest.sourceFile} results={latest.computedResults ?? []} />
      ) : null}
      {older.length > 0 && (
        <ul className="ax-work-latest-older">
          {older.map((run) => (
            <li key={run.id}>{formatRelativeTime(run.startedAt)} · {executionTriggerLabel(run.triggerType)} · {run.status === 'success' ? '완료' : executionStatusLabel(run.status)}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
