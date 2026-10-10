import { useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { getNodesBounds, useReactFlow, useStoreApi, type Node } from '@xyflow/react';
import { draftToFlow } from '../draft-to-flow.js';
import { computeWorkflowDiff } from '../workflow-diff.js';
import type { WorkflowVisualNodeData } from '../types.js';
import type { WorkflowGraphProps } from './contracts.js';

type WorkflowGraphModel = ReturnType<typeof draftToFlow>;

/** Below this zoom the step labels cannot be read; a tall flow scrolls instead of shrinking further. */
export const READABLE_ZOOM = 0.8;

export interface WorkflowGraphState {
  graph: WorkflowGraphModel;
  nodes: Node<WorkflowVisualNodeData>[];
  collapseSystemSteps: boolean;
  setCollapseSystemSteps: Dispatch<SetStateAction<boolean>>;
}

function nodeIdsKey(nodes: Node<WorkflowVisualNodeData>[]): string {
  return nodes.map((node) => node.id).join('\0');
}

export function useWorkflowGraphState({
  draft,
  baselineDraft,
  completeness,
  expanded = false,
  selectedNodeId,
  autoSelectSourceId,
  onSelectNode,
}: WorkflowGraphProps): WorkflowGraphState {
  const { fitView, getNodes, getZoom, setViewport } = useReactFlow();
  const store = useStoreApi();
  const [collapseSystemSteps, setCollapseSystemSteps] = useState(true);
  const [enteringIds, setEnteringIds] = useState<Set<string>>(() => new Set());
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

  const graphNodeIdsKey = useMemo(() => nodeIdsKey(graph.nodes), [graph.nodes]);

  useEffect(() => {
    const currentIds = new Set(graph.nodes.map((node) => node.id));
    const entering = new Set<string>();
    for (const id of currentIds) {
      if (!prevNodeIdsRef.current.has(id)) entering.add(id);
    }
    prevNodeIdsRef.current = currentIds;
    if (entering.size === 0) {
      // A cleanup may have cancelled the previous reset timer; never leave stale enter classes behind.
      setEnteringIds((prev) => (prev.size === 0 ? prev : new Set()));
      return;
    }

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
      void fitView({ padding: expanded ? 0.2 : 0.35 }).then(() => {
        if (getZoom() >= READABLE_ZOOM) return;
        // Too tall or wide to fit legibly: keep a readable size and start at the trigger, centred.
        const bounds = getNodesBounds(getNodes());
        const { width } = store.getState();
        void setViewport({
          x: width / 2 - (bounds.x + bounds.width / 2) * READABLE_ZOOM,
          y: 24 - bounds.y * READABLE_ZOOM,
          zoom: READABLE_ZOOM,
        });
      });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [graphNodeIdsKey, expanded, graph.hasContent, fitView, getNodes, getZoom, setViewport, store]);

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

  return { graph, nodes, collapseSystemSteps, setCollapseSystemSteps };
}
