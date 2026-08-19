import { GMAIL_READ_WORKFLOW_NODE_ID } from '@ax-studio/core/workflow-constants';
import type { InterviewDraft, WorkflowNode } from '@ax-studio/core/workflow-schema';
import type { CompletenessResult } from '@ax-studio/core/requiredness';
import type { Edge, Node } from '@xyflow/react';
import {
  displayForTrigger,
  displayForWorkflowNode,
} from './node-display.js';
import { connectorIconSrc } from './node-icons.js';
import { layoutWithDagre } from './layout/dagre-layout.js';
import type { WorkflowNodeChange, WorkflowVisualNodeData } from './types.js';
import {
  WORKFLOW_JOIN_SIZE,
  WORKFLOW_NODE_HEIGHT,
  WORKFLOW_NODE_WIDTH,
} from './types.js';

export interface DraftToFlowOptions {
  completeness?: CompletenessResult;
  nodeChanges?: Map<string, WorkflowNodeChange>;
  triggerChanged?: boolean;
  collapseSystemSteps?: boolean;
}

interface BuildContext extends DraftToFlowOptions {
  draft: InterviewDraft;
  nodes: Node<WorkflowVisualNodeData>[];
  edges: Edge[];
  byId: Map<string, WorkflowNode>;
  enterCounter: number;
}

function branchChildIds(nodes: WorkflowNode[]): Set<string> {
  const ids = new Set<string>();
  for (const node of nodes) {
    if (node.type !== 'if') continue;
    node.thenStepIds?.forEach((id) => ids.add(id));
    node.elseStepIds?.forEach((id) => ids.add(id));
  }
  return ids;
}

function topLevelNodes(nodes: WorkflowNode[]): WorkflowNode[] {
  const childIds = branchChildIds(nodes);
  return nodes.filter((node) => !childIds.has(node.id));
}

function isGmailReadNode(node: WorkflowNode): boolean {
  return (
    node.id === GMAIL_READ_WORKFLOW_NODE_ID ||
    (node.type === 'action' &&
      node.connector === 'gmail' &&
      (node.action === 'messages.read' || node.action === 'message.read'))
  );
}

function changeFor(ctx: BuildContext, sourceId: string): WorkflowNodeChange | undefined {
  if (sourceId === '__trigger__') {
    return ctx.triggerChanged ? 'modified' : 'unchanged';
  }
  return ctx.nodeChanges?.get(sourceId);
}

function nextEnterIndex(ctx: BuildContext): number {
  const index = ctx.enterCounter;
  ctx.enterCounter += 1;
  return index;
}

function addNode(
  ctx: BuildContext,
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

function addEdge(ctx: BuildContext, source: string, target: string, label?: string): void {
  ctx.edges.push({
    id: `${source}->${target}${label ? `:${label}` : ''}`,
    source,
    target,
    label,
    type: 'smoothstep',
    animated: false,
    selectable: false,
  });
}

function emitSystemGmailRead(ctx: BuildContext): string {
  const flowId = `step:${GMAIL_READ_WORKFLOW_NODE_ID}`;
  const collapsed = ctx.collapseSystemSteps ?? true;
  addNode(
    ctx,
    flowId,
    {
      kind: 'system',
      label: '읽기',
      subtitle: '트리거 메일의 전체 본문을 가져옵니다',
      lines: [{ text: 'Gmail 트리거 후 자동 실행', complete: true }],
      incomplete: false,
      sourceId: GMAIL_READ_WORKFLOW_NODE_ID,
      systemInjected: true,
      collapsed,
      iconSrc: connectorIconSrc('gmail'),
      tooltip: '자동 · 메일 본문 읽기',
      card: {
        header: '자동',
        brand: 'Gmail',
        brandStyle: 'bracket',
        summary: '메일 읽기',
      },
      change: ctx.nodeChanges?.get(GMAIL_READ_WORKFLOW_NODE_ID) ?? 'unchanged',
    },
  );
  return flowId;
}

function emitWorkflowNode(ctx: BuildContext, node: WorkflowNode): string {
  if (isGmailReadNode(node)) {
    return emitSystemGmailRead(ctx);
  }

  const display = displayForWorkflowNode(node, ctx.completeness?.slots);
  const flowId = `step:${node.id}`;
  addNode(ctx, flowId, {
    kind: display.kind,
    label: display.label,
    subtitle: display.subtitle,
    lines: display.lines,
    incomplete: display.incomplete,
    sourceId: node.id,
    conditionLabel: display.conditionLabel,
    iconSrc: display.iconSrc,
    tooltip: display.tooltip,
    card: display.card,
    change: changeFor(ctx, node.id),
  });
  return flowId;
}

function emitSequence(ctx: BuildContext, ids: string[], incoming: string | null): string | null {
  let previous = incoming;
  let last: string | null = null;

  for (const id of ids) {
    const node = ctx.byId.get(id);
    if (!node) continue;
    if (isGmailReadNode(node)) continue;

    const flowId = emitWorkflowNode(ctx, node);
    if (previous) addEdge(ctx, previous, flowId);

    if (node.type === 'if') {
      const joinId = `join:${node.id}`;
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
        const firstThen = ctx.byId.get(thenIds[0]);
        if (firstThen && !isGmailReadNode(firstThen)) addEdge(ctx, flowId, `step:${firstThen.id}`, '예');
        thenLast = emitSequence(ctx, thenIds, null) ?? flowId;
      }

      let elseLast = flowId;
      if (elseIds.length > 0) {
        const firstElse = ctx.byId.get(elseIds[0]);
        if (firstElse && !isGmailReadNode(firstElse)) addEdge(ctx, flowId, `step:${firstElse.id}`, '아니오');
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

function shouldInjectGmailRead(draft: InterviewDraft, nodes: WorkflowNode[]): boolean {
  if (draft.triggerType !== 'gmail.new_message') return false;
  return !nodes.some((node) => isGmailReadNode(node));
}

export interface DraftFlowGraph {
  nodes: Node<WorkflowVisualNodeData>[];
  edges: Edge[];
  hasContent: boolean;
}

export function draftToFlow(
  draft: InterviewDraft | undefined,
  options: DraftToFlowOptions = {},
): DraftFlowGraph {
  if (!draft) {
    return { nodes: [], edges: [], hasContent: false };
  }

  const workflowNodes = draft.nodes ?? [];
  const ctx: BuildContext = {
    draft,
    ...options,
    nodes: [],
    edges: [],
    byId: new Map(workflowNodes.map((node) => [node.id, node])),
    enterCounter: 0,
  };

  const trigger = displayForTrigger(draft, options.completeness?.slots);
  addNode(ctx, 'trigger', {
    kind: 'trigger',
    label: trigger.label,
    subtitle: trigger.subtitle,
    lines: trigger.lines,
    incomplete: trigger.incomplete,
    sourceId: '__trigger__',
    iconSrc: trigger.iconSrc,
    tooltip: trigger.tooltip,
    card: trigger.card,
    change: changeFor(ctx, '__trigger__'),
  });

  const sequence = topLevelNodes(workflowNodes).filter((node) => !isGmailReadNode(node));
  const readNodes = topLevelNodes(workflowNodes).filter(isGmailReadNode);
  const injectRead = shouldInjectGmailRead(draft, workflowNodes);
  const hasReadStep = injectRead || readNodes.length > 0;

  if (sequence.length === 0 && !hasReadStep) {
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
  } else {
    let chainFrom = 'trigger';
    if (hasReadStep) {
      const readId =
        readNodes.length > 0 ? emitWorkflowNode(ctx, readNodes[0]!) : emitSystemGmailRead(ctx);
      addEdge(ctx, 'trigger', readId);
      chainFrom = readId;
    }
    if (sequence.length > 0) {
      const first = sequence[0];
      addEdge(ctx, chainFrom, `step:${first.id}`);
      emitSequence(ctx, sequence.map((node) => node.id), null);
    }
  }

  const laidOut = layoutWithDagre(ctx.nodes, ctx.edges);
  return {
    nodes: laidOut.nodes,
    edges: laidOut.edges,
    hasContent: Boolean(draft.goal?.trim() || workflowNodes.length > 0),
  };
}

export { WORKFLOW_NODE_WIDTH, WORKFLOW_NODE_HEIGHT };
