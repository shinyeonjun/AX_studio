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

  // Filter out internal system diagnostic cards such as "실행 전 계획 검사"
  const visiblePresentations = presentations.filter((presentation) => {
    if (presentation.title === '실행 전 계획 검사') return false;
    if (
      presentation.inputs.length === 0 &&
      presentation.actions.length === 0 &&
      presentation.blocks?.some((block) => block.type === 'decision')
    ) {
      return false;
    }
    return true;
  });

  // Collect input IDs already covered by visible presentations
  const coveredInputIds = new Set(visiblePresentations.flatMap((p) => p.inputs.map((i) => i.id)));
  const remainingInputRequests = inputRequests.filter((req) => !coveredInputIds.has(req.id));

  // If a presentation already provides inputs (such as "공유 대상 선택"), avoid duplicate "추가 정보가 필요합니다" card
  const hasInteractivePresentation = visiblePresentations.some((p) => p.inputs.length > 0);
  const showFallbackInputCard = remainingInputRequests.length > 0 && !hasInteractivePresentation;

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
