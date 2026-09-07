import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import type { WorkspaceSourceRecord } from '@ax-studio/core';
import { WorkspaceSourcesPanel } from './WorkspaceSourcesPanel';

type WorkspaceContextTab = 'sources' | 'flow' | 'workflow';

interface WorkspaceContextPanelProps {
  sources: WorkspaceSourceRecord[];
  sourceBusy: boolean;
  onAttachSource: () => Promise<void>;
  flow?: ReactNode;
  workflow?: ReactNode;
  workflowAvailable?: boolean;
}

const TAB_ORDER: WorkspaceContextTab[] = ['sources', 'flow', 'workflow'];
const TAB_LABELS: Record<WorkspaceContextTab, string> = {
  sources: '자료',
  flow: '흐름',
  workflow: '워크플로우',
};

function WorkflowEmptyState() {
  return (
    <section className="workspace-context-empty" aria-label="워크플로우 없음">
      <span className="workspace-context-empty-icon" aria-hidden="true">◇</span>
      <h2>아직 워크플로우가 없습니다.</h2>
      <p>대화에서 업무 방법이 만들어지면 재사용할 수 있는 순서로 표시됩니다.</p>
    </section>
  );
}

export function WorkspaceContextPanel({
  sources,
  sourceBusy,
  onAttachSource,
  flow,
  workflow,
  workflowAvailable = Boolean(workflow),
}: WorkspaceContextPanelProps) {
  const hasWorkflow = workflowAvailable && Boolean(workflow);
  const [activeTab, setActiveTab] = useState<WorkspaceContextTab>(workflowAvailable ? 'flow' : 'sources');
  const previousWorkflowAvailability = useRef(workflowAvailable);

  useEffect(() => {
    setActiveTab((current) => {
      if (current === 'workflow' && !workflowAvailable) return 'flow';
      if (workflowAvailable && !previousWorkflowAvailability.current) return 'flow';
      return current;
    });
    previousWorkflowAvailability.current = workflowAvailable;
  }, [workflowAvailable]);

  const selectTab = (tab: WorkspaceContextTab) => {
    setActiveTab(tab);
  };

  const handleTabKeyDown = (event: KeyboardEvent<HTMLButtonElement>, tab: WorkspaceContextTab) => {
    const currentIndex = TAB_ORDER.indexOf(tab);
    let nextIndex: number | undefined;
    if (event.key === 'ArrowRight' || event.key === 'ArrowDown') nextIndex = (currentIndex + 1) % TAB_ORDER.length;
    if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') nextIndex = (currentIndex - 1 + TAB_ORDER.length) % TAB_ORDER.length;
    if (event.key === 'Home') nextIndex = 0;
    if (event.key === 'End') nextIndex = TAB_ORDER.length - 1;
    if (nextIndex === undefined) return;

    event.preventDefault();
    const nextTab = TAB_ORDER[nextIndex];
    selectTab(nextTab);
    document.getElementById(`workspace-context-tab-${nextTab}`)?.focus();
  };

  return (
    <aside className="workspace-context-panel">
      <div className="workspace-context-tabs" role="tablist" aria-label="대화 컨텍스트">
        {TAB_ORDER.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            id={`workspace-context-tab-${tab}`}
            aria-selected={activeTab === tab}
            aria-controls={activeTab === tab ? `workspace-context-panel-${tab}` : undefined}
            className={`workspace-context-tab${activeTab === tab ? ' workspace-context-tab--active' : ''}`}
            onClick={() => selectTab(tab)}
            onKeyDown={(event) => handleTabKeyDown(event, tab)}
          >
            {TAB_LABELS[tab]}{tab === 'sources' && <span aria-label={`${sources.length}개`}>{sources.length}</span>}
          </button>
        ))}
      </div>
      <div
        id={`workspace-context-panel-${activeTab}`}
        className="workspace-context-content"
        role="tabpanel"
        tabIndex={0}
        aria-labelledby={`workspace-context-tab-${activeTab}`}
      >
        {activeTab === 'sources' && (
          <WorkspaceSourcesPanel
            sources={sources}
            busy={sourceBusy}
            onAttach={onAttachSource}
          />
        )}
        {activeTab === 'flow' && (flow ?? <div className="workspace-context-empty">현재 실행 흐름이 여기에 표시됩니다.</div>)}
        {activeTab === 'workflow' && (hasWorkflow && workflow ? workflow : <WorkflowEmptyState />)}
      </div>
    </aside>
  );
}
