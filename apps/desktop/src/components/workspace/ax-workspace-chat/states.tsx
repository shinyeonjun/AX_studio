import type { DiscoveryInspectView } from '@ax-studio/core';
import { axStudioLogo } from '../../../constants/brand';
import { DiscoveryReviewCard } from '../DiscoveryReviewCard';
import { WELCOME_EXAMPLES } from './model';

export interface WorkspaceEmptyStageProps {
  discoveryBusy: boolean;
  onAttachExample?: () => Promise<void>;
  onSend: (text: string) => Promise<void>;
}

export function WorkspaceEmptyStage({
  discoveryBusy,
  onAttachExample,
  onSend,
}: WorkspaceEmptyStageProps) {
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
  onPublish: () => Promise<void> | void;
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
