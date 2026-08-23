import { useMemo } from 'react';
import type { CompletenessResult, InterviewDraft } from '@ax-studio/core';
import type { Node } from '@xyflow/react';
import type { SettingsScreen } from '../types/navigation';
import { WorkflowGraph } from './WorkflowGraph.js';
import { NodeDetailPanel } from './NodeDetailPanel.js';
import type { WorkflowVisualNodeData } from './types.js';
import { computeWorkflowDiff, diffLabel } from './workflow-diff.js';

interface WorkflowPreviewPanelProps {
  draft?: InterviewDraft;
  baselineDraft?: InterviewDraft;
  completeness?: CompletenessResult;
  done?: boolean;
  title?: string;
  selectedNode: Node<WorkflowVisualNodeData> | null;
  autoSelectSourceId?: string | null;
  panelBusy?: boolean;
  onSelectNode: (node: Node<WorkflowVisualNodeData> | null) => void;
  onRequestEdit: (prompt: string) => void;
  onOpenSettings?: (screen: SettingsScreen) => void;
  onCloseDetail: () => void;
}

function missingCount(completeness?: CompletenessResult): number {
  return completeness?.slots?.filter((slot) => !slot.filled).length ?? 0;
}

export function WorkflowPreviewPanel({
  draft,
  baselineDraft,
  completeness,
  done = false,
  title,
  selectedNode,
  autoSelectSourceId,
  panelBusy = false,
  onSelectNode,
  onRequestEdit,
  onOpenSettings,
  onCloseDetail,
}: WorkflowPreviewPanelProps) {
  const missing = useMemo(() => missingCount(completeness), [completeness]);
  const diff = useMemo(() => computeWorkflowDiff(baselineDraft, draft), [baselineDraft, draft]);
  const diffText = diffLabel(diff);

  const statusLabel = done
    ? diff.hasChanges && diffText
      ? `검토 · ${diffText}`
      : '설계 완료'
    : missing > 0
      ? `설계 중 · ${missing}개 확인 필요`
      : diffText
        ? `설계 중 · ${diffText}`
        : '설계 중';

  return (
    <aside className={`wf-preview ${done ? 'wf-preview-review' : ''}`}>
      <div className="wf-preview-header">
        <div>
          <div className="wf-preview-kicker">워크플로우</div>
          <h2 className="wf-preview-title">{title?.trim() || draft?.name || '새 업무'}</h2>
          {diff.hasChanges && diffText && (
            <p className="wf-preview-diff">{diffText}</p>
          )}
        </div>
        <span className={`wf-preview-status ${done ? 'wf-preview-status-done' : ''}`}>{statusLabel}</span>
      </div>

      <div className="wf-preview-graph-wrap">
        <WorkflowGraph
          draft={draft}
          baselineDraft={baselineDraft}
          completeness={completeness}
          expanded={done}
          selectedNodeId={selectedNode?.id ?? null}
          autoSelectSourceId={done ? null : autoSelectSourceId ?? null}
          onSelectNode={onSelectNode}
        />
      </div>

      {selectedNode && selectedNode.data.kind !== 'system' && (
        <NodeDetailPanel
          draft={draft}
          nodeData={selectedNode.data}
          completeness={completeness}
          busy={panelBusy}
          onRequestEdit={onRequestEdit}
          onOpenSettings={onOpenSettings}
          onClose={onCloseDetail}
        />
      )}

      {selectedNode?.data.kind === 'system' && (
        <div className="wf-detail-panel wf-detail-panel-system">
          <div className="wf-detail-kicker">자동 워크플로우 노드</div>
          <h3 className="wf-detail-title">{selectedNode.data.label}</h3>
          <p className="wf-detail-subtitle">
            {selectedNode.data.subtitle ?? selectedNode.data.tooltip ?? selectedNode.data.card?.summary}
          </p>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCloseDetail}>
            닫기
          </button>
        </div>
      )}

      {done && draft && (
        <div className="wf-preview-review-notes">
          <p>{draft.goal}</p>
          {draft.success && <p className="muted">완료: {draft.success}</p>}
        </div>
      )}
    </aside>
  );
}
