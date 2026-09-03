import type { WorkflowCanvasDraft } from '@ax-studio/core';
import { displayForTrigger } from './node-display.js';
import { layoutWithDagre } from './layout/dagre-layout.js';
import {
  WORKFLOW_NODE_HEIGHT,
  WORKFLOW_NODE_WIDTH,
} from './types.js';
import {
  addEdge,
  addNode,
  emitSystemGmailRead,
  emitWorkflowNode,
  isGmailReadNode,
} from './draft-to-flow/nodes.js';
import { createDraftFlowContext } from './draft-to-flow/context.js';
import type {
  DraftFlowBuildContext,
  DraftFlowGraph,
  DraftToFlowOptions,
} from './draft-to-flow/contracts.js';
import { emitSequence, shouldInjectGmailRead, topLevelNodes } from './draft-to-flow/sequence.js';

export type { DraftFlowGraph, DraftToFlowOptions } from './draft-to-flow/contracts.js';

function addPlaceholder(ctx: DraftFlowBuildContext): void {
  addNode(ctx, 'placeholder', {
    kind: 'placeholder',
    label: '다음',
    subtitle: '대화로 업무 순서를 정합니다',
    lines: [{ text: '아직 노드 없음', complete: false }],
    incomplete: true,
    tooltip: '다음 워크플로우 노드',
    card: {
      header: '…',
      brand: 'Next',
      brandStyle: 'bracket',
      summary: '노드 추가',
    },
    change: 'added',
  });
  addEdge(ctx, 'trigger', 'placeholder');
}

function addTrigger(ctx: DraftFlowBuildContext): void {
  const trigger = displayForTrigger(ctx.draft, ctx.completeness?.slots);
  addNode(ctx, 'trigger', {
    kind: 'trigger',
    label: trigger.label,
    subtitle: trigger.subtitle,
    lines: trigger.lines,
    incomplete: trigger.incomplete,
    sourceId: '__trigger__',
    iconSrc: trigger.iconSrc,
    iconEmoji: trigger.iconEmoji,
    tooltip: trigger.tooltip,
    card: trigger.card,
    change: ctx.triggerChanged ? 'modified' : 'unchanged',
  });
}

function addWorkflowSequence(ctx: DraftFlowBuildContext): void {
  const workflowNodes = ctx.draft.nodes ?? [];
  const sequence = topLevelNodes(workflowNodes).filter((node) => !isGmailReadNode(node));
  const readNodes = topLevelNodes(workflowNodes).filter(isGmailReadNode);
  const injectRead = shouldInjectGmailRead(ctx.draft, workflowNodes);
  const hasReadStep = injectRead || readNodes.length > 0;

  if (sequence.length === 0 && !hasReadStep) {
    addPlaceholder(ctx);
    return;
  }

  let chainFrom = 'trigger';
  if (hasReadStep) {
    const readId =
      readNodes.length > 0 ? emitWorkflowNode(ctx, readNodes[0]!) : emitSystemGmailRead(ctx);
    addEdge(ctx, 'trigger', readId);
    chainFrom = readId;
  }
  if (sequence.length > 0) {
    const first = sequence[0]!;
    addEdge(ctx, chainFrom, 'step:' + first.id);
    emitSequence(ctx, sequence.map((node) => node.id), null);
  }
}

export function draftToFlow(
  draft: WorkflowCanvasDraft | undefined,
  options: DraftToFlowOptions = {},
): DraftFlowGraph {
  if (!draft) {
    return { nodes: [], edges: [], hasContent: false };
  }

  const ctx = createDraftFlowContext(draft, options);
  addTrigger(ctx);
  addWorkflowSequence(ctx);

  const laidOut = layoutWithDagre(ctx.nodes, ctx.edges);
  return {
    nodes: laidOut.nodes,
    edges: laidOut.edges,
    hasContent: Boolean(draft.goal?.trim() || (draft.nodes?.length ?? 0) > 0),
  };
}

export { WORKFLOW_NODE_WIDTH, WORKFLOW_NODE_HEIGHT };
