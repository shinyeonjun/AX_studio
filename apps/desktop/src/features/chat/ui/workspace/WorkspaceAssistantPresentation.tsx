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

  // Host-marked diagnostic cards (internal plan checks) are not interactive chat content.
  // Only cards that carry nothing actionable may be hidden this way.
  const visiblePresentations = presentations.filter((presentation) =>
    !(presentation.role === 'diagnostic' && presentation.inputs.length === 0 && presentation.actions.length === 0));

  // Inputs already rendered by a visible presentation are not repeated in the fallback card;
  // any input request that no card covers is still shown so required inputs are never hidden.
  const coveredInputIds = new Set(visiblePresentations.flatMap((p) => p.inputs.map((i) => i.id)));
  const remainingInputRequests = inputRequests.filter((req) => !coveredInputIds.has(req.id));
  const showFallbackInputCard = remainingInputRequests.length > 0;

  if (visiblePresentations.length === 0 && !showFallbackInputCard) return null;

  return (
    <div className="ax-workspace-presentation-list">
      {visiblePresentations.map((presentation, index) => (
        <PresentationCard
          key={`${presentation.title}-${index}`}
          presentation={presentation}
          busy={busy}
          interactive={interactive}
          onSend={onSend}
        />
      ))}
      {showFallbackInputCard && (
        <PresentationCard
          presentation={{
            title: '추가 정보가 필요합니다',
            inputMode: 'batch',
            blocks: [],
            inputs: remainingInputRequests,
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
