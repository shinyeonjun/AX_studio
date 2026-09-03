import type { CompletenessResult, WorkflowCanvasDraft, WorkflowNode } from '@ax-studio/core';
import type { Edge, Node } from '@xyflow/react';
import type { WorkflowNodeChange, WorkflowVisualNodeData } from '../types.js';

export interface DraftToFlowOptions {
  completeness?: CompletenessResult;
  nodeChanges?: Map<string, WorkflowNodeChange>;
  triggerChanged?: boolean;
  collapseSystemSteps?: boolean;
}

export interface DraftFlowGraph {
  nodes: Node<WorkflowVisualNodeData>[];
  edges: Edge[];
  hasContent: boolean;
}

export interface DraftFlowBuildContext extends DraftToFlowOptions {
  draft: WorkflowCanvasDraft;
  nodes: Node<WorkflowVisualNodeData>[];
  edges: Edge[];
  byId: Map<string, WorkflowNode>;
  enterCounter: number;
}
