import { useCallback, useRef } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  type Node,
  type OnSelectionChangeFunc,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { WorkflowStepNode } from './nodes/WorkflowStepNode.js';
import type { WorkflowVisualNodeData } from './types.js';
import { useWorkflowGraphState } from './workflow-graph/state.js';
import type { WorkflowGraphProps } from './workflow-graph/contracts.js';

const nodeTypes = { workflowStep: WorkflowStepNode };

function WorkflowGraphInner({
  draft,
  baselineDraft,
  completeness,
  expanded = false,
  selectedNodeId,
  autoSelectSourceId,
  onSelectNode,
}: WorkflowGraphProps) {
  const selectedNodeIdRef = useRef<string | null>(selectedNodeId ?? null);
  selectedNodeIdRef.current = selectedNodeId ?? null;
  const { graph, nodes, collapseSystemSteps, setCollapseSystemSteps } = useWorkflowGraphState({
    draft,
    baselineDraft,
    completeness,
    expanded,
    selectedNodeId,
    autoSelectSourceId,
    onSelectNode,
  });

  const handleSelectionChange: OnSelectionChangeFunc = useCallback(
    ({ nodes: selected }) => {
      const picked = selected[0] as Node<WorkflowVisualNodeData> | undefined;
      const nextId = !picked || picked.data.kind === 'join' ? null : picked.id;
      if (nextId === selectedNodeIdRef.current) return;
      if (!nextId || !picked) {
        onSelectNode?.(null);
        return;
      }
      onSelectNode?.(picked);
    },
    [onSelectNode],
  );

  const handleNodeClick = useCallback(
    (_event: React.MouseEvent, node: Node<WorkflowVisualNodeData>) => {
      if (node.data.kind === 'system' && node.data.collapsed) {
        setCollapseSystemSteps(false);
        return;
      }
      if (node.data.kind === 'join') {
        onSelectNode?.(null);
      }
    },
    [onSelectNode],
  );

  if (!graph.hasContent) {
    return (
      <div className="wf-graph-empty">
        <p>업무 흐름이 여기에 표시됩니다</p>
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
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="var(--wf-grid-color)" />
        {expanded && <MiniMap pannable zoomable nodeStrokeWidth={2} className="wf-minimap" />}
        {expanded && <Controls showInteractive={false} className="wf-controls" />}
      </ReactFlow>
    </div>
  );
}

export function WorkflowGraph(props: WorkflowGraphProps) {
  return (
    <ReactFlowProvider>
      <WorkflowGraphInner {...props} />
    </ReactFlowProvider>
  );
}
