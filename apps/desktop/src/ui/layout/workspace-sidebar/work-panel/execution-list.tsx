import type { AppState } from '../../../../types/app-state';
import type { ChatSessionSummary } from '../../../../features/chat/hooks/useChatSessions';
import { executionErrorLabel, executionStatusLabel, executionTriggerLabel, formatRelativeTime } from '../../../lib/work-display';

export type ExecutionSummary = AppState['executions'][number];

function executionTitle(execution: ExecutionSummary, sessions: ChatSessionSummary[]): string {
  const sessionTitle = sessions.find((session) => session.id === execution.workspaceSessionId)?.title;
  if (sessionTitle?.trim()) return sessionTitle;
  if (execution.generatedPdf?.fileName) return execution.generatedPdf.fileName;
  return execution.name?.trim() || '직접 실행';
}

function executionPresentation(execution: ExecutionSummary): {
  tone: 'success' | 'running' | 'pending' | 'failed' | 'neutral';
  label: string;
} {
  if (execution.resultStatus === 'failed' || execution.status === 'failed') {
    return { tone: 'failed', label: execution.resultStatus === 'failed' ? '결과 검토 필요' : '실패' };
  }
  if (execution.status === 'pending_approval') return { tone: 'pending', label: '승인 대기' };
  if (execution.status === 'running') return { tone: 'running', label: '실행 중' };
  if (execution.status === 'success') return { tone: 'success', label: '완료' };
  return { tone: 'neutral', label: executionStatusLabel(execution.status) };
}

function executionDetail(execution: ExecutionSummary): string {
  if (execution.currentStepMessage) return execution.currentStepMessage;
  const error = executionErrorLabel(execution.errorCode);
  if (error) return error;
  return executionTriggerLabel(execution.triggerType);
}

/** Recent one-off runs; each opens its result chat, or Activity when it has none. */
export function ExecutionList({ executions, sessions, onOpen }: {
  executions: ExecutionSummary[];
  sessions: ChatSessionSummary[];
  onOpen: (execution: ExecutionSummary) => void;
}) {
  return (
    <ul className="sidebar-execution-list">
      {executions.map((execution) => {
        const presentation = executionPresentation(execution);
        const title = executionTitle(execution, sessions);
        return (
          <li key={execution.id}>
            <button
              type="button"
              className={`sidebar-execution-item tone-${presentation.tone}`}
              onClick={() => onOpen(execution)}
              aria-label={`${title}, ${presentation.label}, ${execution.workspaceSessionId ? '결과 대화 보기' : '활동에서 보기'}`}
            >
              <span className={`sidebar-execution-dot tone-${presentation.tone}`} aria-hidden="true" />
              <span className="sidebar-execution-copy">
                <span className="sidebar-execution-title">{title}</span>
                <span className="sidebar-execution-meta">
                  <strong>{presentation.label}</strong>
                  <span>·</span>
                  <span>{formatRelativeTime(execution.startedAt)}</span>
                </span>
                <span className="sidebar-execution-detail">{executionDetail(execution)}</span>
              </span>
              <span className="sidebar-execution-open" aria-hidden="true">보기</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
