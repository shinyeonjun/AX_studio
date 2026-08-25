import { useState } from 'react';
import type { AxInputRequest, AxUiPresentation } from '@ax-studio/core';

interface WorkspaceAssistantPresentationProps {
  presentations?: AxUiPresentation[];
  inputRequests?: AxInputRequest[];
  busy: boolean;
  /** Only the latest assistant turn may submit actions; stale cards render read-only. */
  interactive?: boolean;
  onSend: (text: string) => Promise<void>;
}

function InputRequestCard({
  request,
  busy,
  onSend,
}: {
  request: AxInputRequest;
  busy: boolean;
  onSend: (text: string) => Promise<void>;
}) {
  const [value, setValue] = useState('');
  const submit = () => {
    const normalized = value.trim();
    if ((!normalized && request.required) || busy) return;
    void onSend(`${request.label}: ${normalized}`);
    setValue('');
  };

  return (
    <div className="ax-workspace-presentation-input" data-testid={`input-request-${request.id}`}>
      <div className="ax-workspace-presentation-input-copy">
        <strong>{request.label}</strong>
        {request.reason && <span>{request.reason}</span>}
      </div>
      <div className="ax-workspace-presentation-input-row">
        <input
          type={request.type === 'email' ? 'email' : 'text'}
          value={value}
          placeholder={request.placeholder ?? '값을 입력하세요'}
          disabled={busy}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault();
              submit();
            }
          }}
        />
        <button type="button" disabled={busy || (request.required && !value.trim())} onClick={submit}>
          입력
        </button>
      </div>
    </div>
  );
}

function PresentationBlock({ block }: { block: AxUiPresentation['blocks'][number] }) {
  switch (block.type) {
    case 'source':
      return (
        <div className="ax-workspace-presentation-source">
          <strong>{block.fileName}</strong>
          {block.detail && <span>{block.detail}</span>}
          {block.citation && <small>{block.citation}</small>}
        </div>
      );
    case 'decision':
      return (
        <div className="ax-workspace-presentation-decision">
          <span>{block.label}</span>
          <strong>{block.value}</strong>
          {block.reason && <p>{block.reason}</p>}
        </div>
      );
    case 'steps':
      return (
        <div className="ax-workspace-presentation-steps">
          {block.title && <strong>{block.title}</strong>}
          <ol>
            {block.items.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
          </ol>
        </div>
      );
    case 'note':
      return <p className="ax-workspace-presentation-note">{block.text}</p>;
  }
}

function PresentationCard({
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
  return (
    <section className="ax-workspace-presentation" aria-label={presentation.title}>
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
              disabled={locked}
              onClick={() => void onSend(action.value)}
            >
              {action.label}
            </button>
          ))}
        </div>
      )}
    </section>
  );
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
            blocks: [],
            inputs: inputRequests,
            actions: [],
          }}
          busy={busy}
          interactive={interactive}
          onSend={onSend}
        />
      )}
    </div>
  );
}
