import type { ReactNode } from 'react';
import {
  WORKFLOW_PANEL_MAX_WIDTH,
  WORKFLOW_PANEL_MIN_WIDTH,
} from '../../hooks/useWorkflowPanelWidth';

interface WorkConversationSplitProps {
  width: number;
  isResizing: boolean;
  onSplitterPointerDown: (event: React.PointerEvent<HTMLDivElement>) => void;
  onSplitterDoubleClick?: () => void;
  chat: ReactNode;
  panel: ReactNode;
}

export function WorkConversationSplit({
  width,
  isResizing,
  onSplitterPointerDown,
  onSplitterDoubleClick,
  chat,
  panel,
}: WorkConversationSplitProps) {
  return (
    <div
      className={`work-conversation-body${isResizing ? ' work-conversation-body--resizing' : ''}`}
      style={{ gridTemplateColumns: `minmax(0, 1fr) 5px ${width}px` }}
    >
      <div className="work-conversation-chat">{chat}</div>
      <div
        className="work-conversation-splitter"
        role="separator"
        aria-orientation="vertical"
        aria-label="대화 컨텍스트 패널 너비 조절"
        aria-valuenow={width}
        aria-valuemin={WORKFLOW_PANEL_MIN_WIDTH}
        aria-valuemax={WORKFLOW_PANEL_MAX_WIDTH}
        tabIndex={0}
        onPointerDown={onSplitterPointerDown}
        onDoubleClick={onSplitterDoubleClick}
      />
      {panel}
    </div>
  );
}
