import { getCapability } from '@ax-studio/core/catalog-data';
import { GMAIL_READ_WORKFLOW_NODE_ID } from '@ax-studio/core/workflow/canvas/compile/constants';
import type { WorkflowNode } from '@ax-studio/core';
import {
  displayForWorkflowNode,
  displayForCapability,
} from '../node-display.js';
import { workflowNodeIcon } from '../workflow-icons.js';
import type { DraftFlowBuildContext } from './contracts.js';
import type { WorkflowNodeChange, WorkflowVisualNodeData } from '../types.js';

export function isGmailReadNode(node: WorkflowNode): boolean {
  return (
    node.id === GMAIL_READ_WORKFLOW_NODE_ID ||
    (node.type === 'action' &&
      node.connector === 'gmail' &&
      (node.action === 'messages.read' || node.action === 'message.read'))
  );
}

function changeFor(ctx: DraftFlowBuildContext, sourceId: string): WorkflowNodeChange | undefined {
  if (sourceId === '__trigger__') {
    return ctx.triggerChanged ? 'modified' : 'unchanged';
  }
  return ctx.nodeChanges?.get(sourceId);
}

function nextEnterIndex(ctx: DraftFlowBuildContext): number {
  const index = ctx.enterCounter;
  ctx.enterCounter += 1;
  return index;
}

export function addNode(
  ctx: DraftFlowBuildContext,
  id: string,
  data: WorkflowVisualNodeData,
  size?: { width: number; height: number },
): void {
  ctx.nodes.push({
    id,
    type: 'workflowStep',
    position: { x: 0, y: 0 },
    data: {
      ...data,
      enterIndex: nextEnterIndex(ctx),
    },
    draggable: false,
    selectable: data.kind !== 'join' && !data.collapsed,
    connectable: false,
    width: size?.width,
    height: size?.height,
  });
}

export function addEdge(
  ctx: DraftFlowBuildContext,
  source: string,
  target: string,
  label?: string,
): void {
  ctx.edges.push({
    id: source + '->' + target + (label ? ':' + label : ''),
    source,
    target,
    label,
    type: 'smoothstep',
    animated: false,
    selectable: false,
  });
}

export function emitSystemGmailRead(ctx: DraftFlowBuildContext): string {
  const flowId = 'step:' + GMAIL_READ_WORKFLOW_NODE_ID;
  const collapsed = ctx.collapseSystemSteps ?? true;
  const cap = getCapability('gmail.messages.read');
  const card = displayForCapability('gmail.messages.read');
  const icon = workflowNodeIcon('gmail');
  addNode(
    ctx,
    flowId,
    {
      kind: 'system',
      label: cap?.label ?? card.summary,
      subtitle: cap?.description,
      lines: [{ text: cap?.description ?? card.summary, complete: true }],
      incomplete: false,
      sourceId: GMAIL_READ_WORKFLOW_NODE_ID,
      systemInjected: true,
      collapsed,
      iconSrc: icon.src,
      iconEmoji: icon.emoji,
      tooltip: cap?.label ?? card.summary,
      card: {
        ...card,
        header: '자동',
      },
      change: ctx.nodeChanges?.get(GMAIL_READ_WORKFLOW_NODE_ID) ?? 'unchanged',
    },
  );
  return flowId;
}

export function emitWorkflowNode(ctx: DraftFlowBuildContext, node: WorkflowNode): string {
  if (isGmailReadNode(node)) {
    return emitSystemGmailRead(ctx);
  }

  const display = displayForWorkflowNode(ctx.draft, node, ctx.completeness?.slots);
  const flowId = 'step:' + node.id;
  addNode(ctx, flowId, {
    kind: display.kind,
    label: display.label,
    subtitle: display.subtitle,
    lines: display.lines,
    incomplete: display.incomplete,
    sourceId: node.id,
    conditionLabel: display.conditionLabel,
    iconSrc: display.iconSrc,
    iconEmoji: display.iconEmoji,
    tooltip: display.tooltip,
    card: display.card,
    change: changeFor(ctx, node.id),
  });
  return flowId;
}
