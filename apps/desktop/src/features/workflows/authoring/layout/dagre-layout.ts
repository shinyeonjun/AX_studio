import dagre from '@dagrejs/dagre';
import type { Edge, Node } from '@xyflow/react';
import type { WorkflowVisualNodeData } from '../types.js';
import {
  WORKFLOW_JOIN_SIZE,
  WORKFLOW_NODE_HEIGHT,
  WORKFLOW_NODE_WIDTH,
} from '../types.js';

function nodeSize(data: WorkflowVisualNodeData): { width: number; height: number } {
  if (data.kind === 'join') {
    return { width: WORKFLOW_JOIN_SIZE, height: WORKFLOW_JOIN_SIZE };
  }
  const hasSub = Boolean(data.card?.captionSub);
  return {
    width: WORKFLOW_NODE_WIDTH,
    height: hasSub ? WORKFLOW_NODE_HEIGHT + 12 : WORKFLOW_NODE_HEIGHT,
  };
}

export function layoutWithDagre(
  nodes: Node<WorkflowVisualNodeData>[],
  edges: Edge[],
): { nodes: Node<WorkflowVisualNodeData>[]; edges: Edge[] } {
  if (nodes.length === 0) return { nodes, edges };

  const graph = new dagre.graphlib.Graph();
  graph.setDefaultEdgeLabel(() => ({}));
  graph.setGraph({ rankdir: 'TB', nodesep: 40, ranksep: 58, marginx: 16, marginy: 16 });

  for (const node of nodes) {
    graph.setNode(node.id, nodeSize(node.data));
  }
  for (const edge of edges) {
    graph.setEdge(edge.source, edge.target);
  }

  dagre.layout(graph);

  const laidOutNodes = nodes.map((node) => {
    const pos = graph.node(node.id);
    const size = nodeSize(node.data);
    return {
      ...node,
      position: {
        x: pos.x - size.width / 2,
        y: pos.y - size.height / 2,
      },
    };
  });

  return { nodes: laidOutNodes, edges };
}
