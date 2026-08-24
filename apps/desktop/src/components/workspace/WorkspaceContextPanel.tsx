import { useEffect, useState, type ReactNode } from 'react';
import type { WorkspaceSourceRecord } from '@ax-studio/core';
import { WorkspaceSourcesPanel } from './WorkspaceSourcesPanel';

interface WorkspaceContextPanelProps {
  sources: WorkspaceSourceRecord[];
  sourceBusy: boolean;
  onAttachSource: () => Promise<void>;
  workflow?: ReactNode;
}

export function WorkspaceContextPanel({
  sources,
  sourceBusy,
  onAttachSource,
  workflow,
}: WorkspaceContextPanelProps) {
  const hasWorkflow = Boolean(workflow);
  const [activeTab, setActiveTab] = useState<'sources' | 'workflow'>(hasWorkflow ? 'workflow' : 'sources');

  useEffect(() => {
    setActiveTab(hasWorkflow ? 'workflow' : 'sources');
  }, [hasWorkflow]);

  return (
    <aside className="workspace-context-panel">
      <div className="workspace-context-tabs" role="tablist" aria-label="대화 컨텍스트">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'sources'}
          className={`workspace-context-tab${activeTab === 'sources' ? ' workspace-context-tab--active' : ''}`}
          onClick={() => setActiveTab('sources')}
        >
          자료 <span>{sources.length}</span>
        </button>
        {hasWorkflow && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'workflow'}
            className={`workspace-context-tab${activeTab === 'workflow' ? ' workspace-context-tab--active' : ''}`}
            onClick={() => setActiveTab('workflow')}
          >
            흐름
          </button>
        )}
      </div>
      <div className="workspace-context-content">
        {activeTab === 'workflow' && workflow ? workflow : (
          <WorkspaceSourcesPanel
            sources={sources}
            busy={sourceBusy}
            onAttach={onAttachSource}
          />
        )}
      </div>
    </aside>
  );
}
