import { useState } from 'react';
import type { AxUiPresentation } from '@ax-studio/core';
import { InputRequestCard, selectedInputText } from './input.js';
import { PresentationBlock } from './block.js';

export function PresentationCard({
  presentation,
  busy,
  interactive,
  onSend,
}: {
  presentation: AxUiPresentation;
  busy: boolean;
  interactive: boolean;
  onSend: (text: string) => Promise<void>;
}) {
  const locked = busy || !interactive;
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const batchInputs = presentation.inputMode === 'batch';
  const requiredInputsReady = presentation.inputs
    .filter((request) => request.required)
    .every((request) => Boolean(inputValues[request.id]?.trim()));
  const submitAction = (action: AxUiPresentation['actions'][number]) => {
    if (locked || (batchInputs && !requiredInputsReady)) return;
    const values = batchInputs
      ? presentation.inputs.map((request) => selectedInputText(request, inputValues[request.id] ?? '')).join('\n')
      : '';
    void onSend([values, action.value].filter(Boolean).join('\n'));
    if (batchInputs) setInputValues({});
  };

  return (
    <section
      className={`ax-workspace-presentation${batchInputs ? ' ax-workspace-presentation--form' : ''}`}
      aria-label={presentation.title}
    >
      <header className="ax-workspace-presentation-header">
        <span className="ax-workspace-presentation-eyebrow">AX 확인</span>
        <h3>{presentation.title}</h3>
        {presentation.subtitle && <p>{presentation.subtitle}</p>}
      </header>
      {presentation.blocks.length > 0 && (
        <div className="ax-workspace-presentation-blocks">
          {presentation.blocks.map((block, index) => <PresentationBlock key={`${block.type}-${index}`} block={block} />)}
        </div>
      )}
      {presentation.inputs.length > 0 && (
        <div className="ax-workspace-presentation-inputs" aria-label="필수 입력">
          {presentation.inputs.map((request) => (
            <InputRequestCard
              key={request.id}
              request={request}
              busy={locked}
              value={inputValues[request.id] ?? ''}
              onChange={(value) => setInputValues((current) => ({ ...current, [request.id]: value }))}
              onClear={() => setInputValues((current) => ({ ...current, [request.id]: '' }))}
              showSubmit={!batchInputs}
              onSend={onSend}
            />
          ))}
        </div>
      )}
      {presentation.actions.length > 0 && (
        <div className="ax-workspace-presentation-actions" aria-label="다음 작업 선택">
          {presentation.actions.map((action) => (
            <button
              key={action.id}
              type="button"
              className={`ax-workspace-presentation-action ax-workspace-presentation-action--${action.tone}`}
              disabled={locked || (batchInputs && !requiredInputsReady)}
              onClick={() => submitAction(action)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
