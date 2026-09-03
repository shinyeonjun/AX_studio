import type { AxUiPresentation } from '@ax-studio/core';

export function PresentationBlock({ block }: { block: AxUiPresentation['blocks'][number] }) {
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
