import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  type Node,
  type OnSelectionChangeFunc,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { draftToFlow } from './draft-to-flow.js';
import { WorkflowStepNode } from './nodes/WorkflowStepNode.js';
import type { WorkflowVisualNodeData } from './types.js';
import type { CompletenessResult } from '@ax-studio/core/requiredness';
import type { InterviewDraft } from '@ax-studio/core/workflow-schema';
import { computeWorkflowDiff } from './workflow-diff.js';

const nodeTypes = { workflowStep: WorkflowStepNode };

interface WorkflowGraphProps {
  draft?: InterviewDraft;
  baselineDraft?: InterviewDraft;
  completeness?: CompletenessResult;
  expanded?: boolean;
  selectedNodeId?: string | null;
  onSelectNode?: (node: Node<WorkflowVisualNodeData> | null) => void;
}

export function WorkflowGraph({
  draft,
  baselineDraft,
  completeness,
  expanded = false,
  selectedNodeId,
  onSelectNode,
}: WorkflowGraphProps) {
  const [collapseSystemSteps, setCollapseSystemSteps] = useState(true);
  const [enteringIds, setEnteringIds] = useState<Set<string>>(new Set());
  const prevNodeIdsRef = useRef<Set<string>>(new Set());

  const diff = useMemo(
    () => computeWorkflowDiff(baselineDraft, draft),
    [baselineDraft, draft],
  );

  const graph = useMemo(
    () =>
      draftToFlow(draft, {
        completeness,
        nodeChanges: diff.nodeChanges,
        triggerChanged: diff.triggerChanged,
        collapseSystemSteps,
      }),
    [draft, completeness, diff, collapseSystemSteps],
  );

  useEffect(() => {
    const currentIds = new Set(graph.nodes.map((node) => node.id));
    const entering = new Set<string>();
    for (const id of currentIds) {
      if (!prevNodeIdsRef.current.has(id)) entering.add(id);
    }
    prevNodeIdsRef.current = currentIds;
    if (entering.size > 0) {
      setEnteringIds(entering);
      const timer = window.setTimeout(() => setEnteringIds(new Set()), 700);
      return () => window.clearTimeout(timer);
    }
  }, [graph.nodes]);

  const nodes = useMemo(() => {
    return graph.nodes.map((node) => ({
      ...node,
      selected: selectedNodeId ? node.id === selectedNodeId : node.selected,
      className: enteringIds.has(node.id) ? 'wf-react-node-enter' : undefined,
      data: {
        ...node.data,
        entering: enteringIds.has(node.id),
      },
    }));
  }, [graph.nodes, selectedNodeId, enteringIds]);

  const handleSelectionChange: OnSelectionChangeFunc = ({ nodes: selected }) => {
    const picked = selected[0] as Node<WorkflowVisualNodeData> | undefined;
    if (!picked || picked.data.kind === 'join') {
      onSelectNode?.(null);
      return;
    }
    onSelectNode?.(picked);
  };

  const handleNodeClick = (_event: React.MouseEvent, node: Node<WorkflowVisualNodeData>) => {
    if (node.data.kind === 'system' && node.data.collapsed) {
      setCollapseSystemSteps(false);
      return;
    }
    if (node.data.kind === 'join') {
      onSelectNode?.(null);
    }
  };

  if (!graph.hasContent) {
    return (
      <div className="wf-graph-empty">
        <p>워크플로우가 여기에 표시됩니다</p>
        <p className="muted">대화를 시작하면 AX가 만드는 노드 순서를 실시간으로 확인할 수 있어요.</p>
      </div>
    );
  }

  return (
    <div className={`wf-graph ${expanded ? 'wf-graph-expanded' : ''}`}>
      {!collapseSystemSteps && draft?.triggerType === 'gmail.new_message' && (
        <div className="wf-graph-toolbar">
          <button
            type="button"
            className="btn btn-sm btn-ghost"
            onClick={() => setCollapseSystemSteps(true)}
          >
            자동 단계 접기
          </button>
        </div>
      )}
      <ReactFlow
        nodes={nodes}
        edges={graph.edges}
        nodeTypes={nodeTypes}
        onSelectionChange={handleSelectionChange}
        onNodeClick={handleNodeClick}
        nodesDraggable={false}
        nodesConnectable={false}
        elementsSelectable
        panOnScroll
        zoomOnScroll
        minZoom={0.35}
        maxZoom={1.4}
        fitView
        fitViewOptions={{ padding: expanded ? 0.2 : 0.35 }}
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="rgba(255,255,255,0.04)" />
        {expanded && <MiniMap pannable zoomable nodeStrokeWidth={2} className="wf-minimap" />}
        {expanded && <Controls showInteractive={false} className="wf-controls" />}
      </ReactFlow>
    </div>
  );
}
