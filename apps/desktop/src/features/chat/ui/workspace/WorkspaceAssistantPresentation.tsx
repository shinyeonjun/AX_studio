import type { AxInputRequest, AxUiPresentation } from '@ax-studio/core';
import { PresentationCard } from './workspace-assistant-presentation/card.js';

interface WorkspaceAssistantPresentationProps {
  presentations?: AxUiPresentation[];
  inputRequests?: AxInputRequest[];
  busy: boolean;
  /** Only the latest assistant turn may submit actions; stale cards render read-only. */
  interactive?: boolean;
  onSend: (text: string) => Promise<void>;
}

export function WorkspaceAssistantPresentation({
  presentations = [],
  inputRequests = [],
  busy,
  interactive = true,
  onSend,
}: WorkspaceAssistantPresentationProps) {
  if (presentations.length === 0 && inputRequests.length === 0) return null;

  return (
    <div className="ax-workspace-presentation-list">
      {presentations.map((presentation, index) => (
        <PresentationCard
          key={`${presentation.title}-${index}`}
          presentation={presentation}
          busy={busy}
          interactive={interactive}
          onSend={onSend}
        />
      ))}
      {inputRequests.length > 0 && (
        <PresentationCard
          presentation={{
            title: '추가 정보가 필요합니다',
            inputMode: 'batch',
            blocks: [],
            inputs: inputRequests,
            actions: [{
              id: 'continue-with-inputs',
              label: '입력값으로 계속',
              value: '입력값을 반영해 계속 진행해줘',
              tone: 'primary',
              purpose: 'reply',
            }],
          }}
          busy={busy}
          interactive={interactive}
          onSend={onSend}
        />
      )}
    </div>
  );
}
