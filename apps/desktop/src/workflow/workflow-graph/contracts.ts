import type { Node } from '@xyflow/react';
import type { CompletenessResult, WorkflowCanvasDraft } from '@ax-studio/core';
import type { WorkflowVisualNodeData } from '../types.js';

export interface WorkflowGraphProps {
  draft?: WorkflowCanvasDraft;
  baselineDraft?: WorkflowCanvasDraft;
  completeness?: CompletenessResult;
  expanded?: boolean;
  selectedNodeId?: string | null;
  autoSelectSourceId?: string | null;
  onSelectNode?: (node: Node<WorkflowVisualNodeData> | null) => void;
}
