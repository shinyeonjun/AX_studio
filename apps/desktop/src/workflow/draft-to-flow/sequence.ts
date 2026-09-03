import type { WorkflowCanvasDraft, WorkflowNode } from '@ax-studio/core';
import { WORKFLOW_JOIN_SIZE } from '../types.js';
import type { DraftFlowBuildContext } from './contracts.js';
import { addEdge, addNode, emitWorkflowNode, isGmailReadNode } from './nodes.js';

function branchChildIds(nodes: WorkflowNode[]): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node.type !== 'if') continue;
    node.thenStepIds?.forEach((id) => ids.add(id));
    node.elseStepIds?.forEach((id) => ids.add(id));
  }
  return ids;
}

export function topLevelNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  const childIds = branchChildIds(nodes);
  return nodes.filter((node) => !childIds.has(node.id));
}

export function emitSequence(
  ctx: DraftFlowBuildContext,
  ids: string[],
  incoming: string | null,
): string | null {
  let previous = incoming;
  let last: string | null = null;

  for (const id of ids) {
    const node = ctx.byId.get(id);
    if (!node) continue;
    if (isGmailReadNode(node)) continue;

    const flowId = emitWorkflowNode(ctx, node);
    if (previous) addEdge(ctx, previous, flowId);

    if (node.type === 'if') {
      const joinId = 'join:' + node.id;
      addNode(ctx, joinId, {
        kind: 'join',
        label: '',
        lines: [],
        incomplete: false,
      }, { width: WORKFLOW_JOIN_SIZE, height: WORKFLOW_JOIN_SIZE });

      const thenIds = node.thenStepIds ?? [];
      const elseIds = node.elseStepIds ?? [];

      let thenLast = flowId;
      if (thenIds.length > 0) {
        const firstThen = ctx.byId.get(thenIds[0]!);
        if (firstThen && !isGmailReadNode(firstThen)) addEdge(ctx, flowId, 'step:' + firstThen.id, '예');
        thenLast = emitSequence(ctx, thenIds, null) ?? flowId;
      }

      let elseLast = flowId;
      if (elseIds.length > 0) {
        const firstElse = ctx.byId.get(elseIds[0]!);
        if (firstElse && !isGmailReadNode(firstElse)) addEdge(ctx, flowId, 'step:' + firstElse.id, '아니오');
        elseLast = emitSequence(ctx, elseIds, null) ?? flowId;
      }

      if (thenLast !== flowId) addEdge(ctx, thenLast, joinId);
      if (elseLast !== flowId && elseLast !== thenLast) addEdge(ctx, elseLast, joinId);
      if (thenLast === flowId && elseLast === flowId) addEdge(ctx, flowId, joinId);

      last = joinId;
      previous = joinId;
      continue;
    }

    last = flowId;
    previous = flowId;
  }

  return last;
}

export function shouldInjectGmailRead(
  draft: WorkflowCanvasDraft,
  nodes: WorkflowNode[],
): boolean {
  if (draft.triggerType !== 'gmail.new_message') return false;
  return !nodes.some((node) => isGmailReadNode(node));
}
