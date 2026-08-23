import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Background,
  Controls,
  MiniMap,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  type Node,
  type OnSelectionChangeFunc,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { draftToFlow } from './draft-to-flow.js';
import { WorkflowStepNode } from './nodes/WorkflowStepNode.js';
import type { WorkflowVisualNodeData } from './types.js';
import type { CompletenessResult, WorkflowCanvasDraft } from '@ax-studio/core';
import { computeWorkflowDiff } from './workflow-diff.js';

const nodeTypes = { workflowStep: WorkflowStepNode };

interface WorkflowGraphProps {
  draft?: WorkflowCanvasDraft;
  baselineDraft?: WorkflowCanvasDraft;
  completeness?: CompletenessResult;
  expanded?: boolean;
  selectedNodeId?: string | null;
  autoSelectSourceId?: string | null;
  onSelectNode?: (node: Node<WorkflowVisualNodeData> | null) => void;
}

function nodeIdsKey(nodes: Node<WorkflowVisualNodeData>[]): string {
  return nodes.map((node) => node.id).join('\0');
}

function WorkflowGraphInner({
  draft,
  baselineDraft,
  completeness,
  expanded = false,
  selectedNodeId,
  autoSelectSourceId,
  onSelectNode,
}: WorkflowGraphProps) {
  const { fitView } = useReactFlow();
  const [collapseSystemSteps, setCollapseSystemSteps] = useState(true);
  const [enteringIds, setEnteringIds] = useState<Set<string>>(() => new Set());
  const prevNodeIdsRef = useRef<Set<string>>(new Set());
  const selectedNodeIdRef = useRef<string | null>(selectedNodeId ?? null);
  selectedNodeIdRef.current = selectedNodeId ?? null;

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

  const graphNodeIdsKey = useMemo(() => nodeIdsKey(graph.nodes), [graph.nodes]);

  useEffect(() => {
    const currentIds = new Set(graph.nodes.map((node) => node.id));
    const entering = new Set<string>();
    for (const id of currentIds) {
      if (!prevNodeIdsRef.current.has(id)) entering.add(id);
    }
    prevNodeIdsRef.current = currentIds;
    if (entering.size === 0) return;

    setEnteringIds((prev) => {
      if (prev.size === entering.size) {
        let same = true;
        for (const id of entering) {
          if (!prev.has(id)) {
            same = false;
            break;
          }
        }
        if (same) return prev;
      }
      return entering;
    });

    const timer = window.setTimeout(() => setEnteringIds(new Set()), 700);
    return () => window.clearTimeout(timer);
  }, [graphNodeIdsKey]);

  useEffect(() => {
    if (!graph.hasContent) return;
    const frame = window.requestAnimationFrame(() => {
      void fitView({ padding: expanded ? 0.2 : 0.35, duration: 180 });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [graphNodeIdsKey, expanded, graph.hasContent, fitView]);

  useEffect(() => {
    if (!autoSelectSourceId || selectedNodeId || !onSelectNode) return;
    const match = graph.nodes.find((node) => node.data.sourceId === autoSelectSourceId);
    if (!match || match.data.kind === 'join') return;
    onSelectNode(match);
  }, [autoSelectSourceId, selectedNodeId, graphNodeIdsKey, graph.nodes, onSelectNode]);

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
        proOptions={{ hideAttribution: true }}
      >
        <Background gap={20} size={1} color="rgba(255,255,255,0.04)" />
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
